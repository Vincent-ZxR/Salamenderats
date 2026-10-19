import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { bordersOf, loadAreas, visitedCountries, type AreaKind } from "./countries";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { mixColor, type Person } from "./person";
import { keyOf, toTileCoords, tileToLonLat, xOf, yOf, Z_SHIFT, Z_SQUADRAT } from "./tiles";

// Bundlers don't emit MapLibre's worker file, so point it at an explicitly bundled copy.
maplibregl.setWorkerUrl(workerUrl);

type FC = FeatureCollection<Polygon>;
const EMPTY: FC = { type: "FeatureCollection", features: [] };
const MIN_Z17_ZOOM = 10;
const MAX_Z17_FEATURES = 40000;

function tileFeature(x: number, y: number, z: number, size = 1): Feature<Polygon> {
  const tl = tileToLonLat(x, y, z);
  const tr = tileToLonLat(x + size, y, z);
  const br = tileToLonLat(x + size, y + size, z);
  const bl = tileToLonLat(x, y + size, z);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[tl, tr, br, bl, tl]] } };
}

function toCollection(keys: Iterable<number>, z: number): FC {
  const features: FC["features"] = [];
  for (const k of keys) features.push(tileFeature(xOf(k, z), yOf(k, z), z));
  return { type: "FeatureCollection", features };
}

/** Exterior contour only: edges of tiles whose neighbour is not in the set. */
function outlineOf(keys: number[], z: number): FeatureCollection {
  const set = new Set(keys);
  const lines: number[][][] = [];
  for (const k of keys) {
    const x = xOf(k, z);
    const y = yOf(k, z);
    const edge = (nx: number, ny: number, a: [number, number], b: [number, number]) => {
      if (!set.has(keyOf(nx, ny, z))) lines.push([tileToLonLat(a[0], a[1], z), tileToLonLat(b[0], b[1], z)]);
    };
    edge(x, y - 1, [x, y], [x + 1, y]);
    edge(x + 1, y, [x + 1, y], [x + 1, y + 1]);
    edge(x, y + 1, [x, y + 1], [x + 1, y + 1]);
    edge(x - 1, y, [x, y], [x, y + 1]);
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }] };
}

export class MapView {
  readonly map: maplibregl.Map;
  private loaded: Promise<void>;
  private ids: string[] = [];
  private people: Person[] = [];
  private show14 = true;
  private show17 = true;
  private fc14 = new WeakMap<Person, FC>();
  private popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "hover-tip" });

  constructor(el: HTMLElement) {
    this.map = new maplibregl.Map({
      container: el,
      center: [4.35, 50.85],
      zoom: 8,
      style: {
        version: 8,
        sources: {
          base: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "base", type: "raster", source: "base" }],
      },
    });
    this.map.addControl(new maplibregl.NavigationControl(), "top-right");
    let controlContainer: HTMLDivElement | null = null;
    this.map.addControl(
      {
        onAdd: (map) => {
          const container = document.createElement("div");
          container.className = "maplibregl-ctrl maplibregl-ctrl-group";
          controlContainer = container;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "maplibregl-ctrl-reset-2d";
          button.textContent = "2D";
          button.title = "Reset to 2D view";
          button.setAttribute("aria-label", "Reset to 2D view");
          button.addEventListener("click", () => map.easeTo({ bearing: 0, pitch: 0 }));
          container.append(button);
          return container;
        },
        onRemove: () => {
          controlContainer?.remove();
          controlContainer = null;
        },
      },
      "top-right",
    );
    this.loaded = new Promise((r) => this.map.once("load", () => r()));
    this.map.on("moveend", () => this.updateZ17());
    this.map.on("mousemove", (e) => this.showTooltip(e.lngLat));
    this.map.on("mouseout", () => this.popup.remove());
    this.map.on("dragstart", () => this.popup.remove());
  }

  private showTooltip(at: maplibregl.LngLat) {
    const visible = this.people.filter((p) => p.visible);
    const [fx, fy] = toTileCoords(at.lat, at.lng);
    const x17 = Math.floor(fx);
    const y17 = Math.floor(fy);
    const k17 = keyOf(x17, y17);
    const k14 = keyOf(x17 >> Z_SHIFT, y17 >> Z_SHIFT, Z_SQUADRAT);
    const fmt = (day: number | undefined) =>
      day !== undefined ? ` <span class="d">${new Date(day * 86_400_000).toLocaleDateString(undefined, { timeZone: "UTC" })}</span>` : "";
    const section = (title: string, owners: { p: Person; day: number | undefined }[]) =>
      owners.length
        ? `<div class="t">${title}</div>${owners
            .map((o) => `<div><span class="swatch" style="background:${o.p.color}"></span>${o.p.name}${fmt(o.day)}</div>`)
            .join("")}`
        : "";
    const parts: string[] = [];
    if (this.show14) {
      parts.push(
        section(
          "Squadrat",
          visible.filter((p) => p.tiles14.has(k14)).map((p) => ({ p, day: p.first14.get(k14) })),
        ),
      );
    }
    if (this.show17 && this.map.getZoom() >= MIN_Z17_ZOOM) {
      parts.push(
        section(
          "Squadratinho",
          visible.filter((p) => p.tiles17.has(k17)).map((p) => ({ p, day: p.first17.get(k17) })),
        ),
      );
    }
    const html = parts.join("");
    if (!html) this.popup.remove();
    else this.popup.setLngLat(at).setHTML(html).addTo(this.map);
  }

  async render(
    people: Person[],
    show14: boolean,
    show17: boolean,
    showMap: boolean,
    combined: Person | null,
    areaKinds: AreaKind[] = [],
  ): Promise<void> {
    await this.loaded;
    const areaSets = await Promise.all(areaKinds.map(async (k) => [k, await loadAreas(k)] as const));
    this.clearYardHighlight();
    this.people = people;
    this.show14 = show14;
    this.show17 = show17;
    this.map.setLayoutProperty("base", "visibility", showMap ? "visible" : "none");

    for (const id of this.ids) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of this.ids) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
    this.ids = [];

    const visible = people.filter((q) => q.visible);
    if (!showMap) {
      // Without the base map, draw borders for the checked area layers; finer ones only when zoomed in.
      const style = { countries: [0, "#777777", 1.2], regions: [4, "#999999", 0.8], departments: [6, "#aaaaaa", 0.6] } as const;
      for (const [kind, areas] of areaSets) {
        const [minzoom, color, width] = style[kind];
        const src = this.track(`borders-${kind}`);
        this.map.addSource(src, { type: "geojson", data: bordersOf(areas) });
        this.map.addLayer({
          id: this.track(`borders-${kind}-line`),
          type: "line",
          source: src,
          minzoom,
          paint: { "line-color": color, "line-width": width },
        });
      }
    }
    if (areaSets.length) {
      // Same player colors as squadrats, with a lower opacity so the map stays readable.
      for (const [kind, areas] of areaSets) {
        const owners = visible.map((p) => visitedCountries(p, areas));
        const groups = new Map<string, { color: string; features: Feature<Polygon | MultiPolygon>[] }>();
        for (const c of areas) {
          const idxs = visible.map((_, i) => i).filter((i) => owners[i].has(c.id));
          if (!idxs.length) continue;
          const id = idxs.join("-");
          let g = groups.get(id);
          if (!g) groups.set(id, (g = { color: mixColor(idxs.map((i) => visible[i])), features: [] }));
          g.features.push(c.country);
        }
        const thin = kind === "countries" ? 1.5 : 1;
        for (const [id, g] of groups) {
          const src = this.track(`gc-${kind}-${id}`);
          this.map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: g.features } });
          this.map.addLayer({
            id: this.track(`gc-${kind}-${id}-fill`),
            type: "fill",
            source: src,
            paint: { "fill-color": g.color, "fill-opacity": 0.15 },
          });
          this.map.addLayer({
            id: this.track(`gc-${kind}-${id}-line`),
            type: "line",
            source: src,
            paint: { "line-color": g.color, "line-width": thin, "line-opacity": 0.5 },
          });
        }
      }
    }
    if (show14) {
      const masks = new Map<number, number[]>();
      visible.forEach((p, i) => {
        for (const k of p.tiles14) masks.set(k, [...(masks.get(k) ?? []), i]);
      });
      const groups = new Map<string, { color: string; keys: number[] }>();
      for (const [k, idxs] of masks) {
        const id = idxs.join("-");
        let g = groups.get(id);
        if (!g) groups.set(id, (g = { color: mixColor(idxs.map((i) => visible[i])), keys: [] }));
        g.keys.push(k);
      }
      for (const [id, g] of groups) this.addSquadrats(id, g.color, toCollection(g.keys, 14));
    }
    if (show17) {
      for (let mask = 1; mask < 1 << visible.length; mask++) {
        this.addSquadratinhos(String(mask), mixColor(visible.filter((_, i) => mask & (1 << i))));
      }
    }
    this.updateZ17();
  }

  async highlightYard(tiles: number[], z: number, box: NonNullable<Person["stats14"]["maxClusterBox"]>, color: string): Promise<void> {
    await this.loaded;
    this.clearYardHighlight();
    if (!tiles.length) return;

    const source = "yard-highlight";
    this.map.addSource(source, { type: "geojson", data: toCollection(tiles, z) });
    this.map.addLayer({
      id: "yard-highlight-fill",
      type: "fill",
      source,
      paint: { "fill-color": "#ffffff", "fill-opacity": 0.55, "fill-antialias": false },
    });
    this.map.addSource("yard-outline", { type: "geojson", data: outlineOf(tiles, z) });
    this.map.addLayer({
      id: "yard-highlight-line",
      type: "line",
      source: "yard-outline",
      paint: { "line-color": color, "line-width": 4 },
    });
    this.fitToBox(box, z);
  }

  async highlightSquare(at: { x: number; y: number }, size: number, z: number, color: string): Promise<void> {
    await this.loaded;
    this.clearYardHighlight();
    const source = "yard-highlight";
    this.map.addSource(source, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [tileFeature(at.x, at.y, z, size)] },
    });
    this.map.addLayer({
      id: "yard-highlight-fill",
      type: "fill",
      source,
      paint: { "fill-color": "#ffffff", "fill-opacity": 0.55 },
    });
    this.map.addLayer({
      id: "yard-highlight-line",
      type: "line",
      source,
      paint: { "line-color": color, "line-width": 5 },
    });
    this.fitToBox({ minX: at.x, minY: at.y, maxX: at.x + size - 1, maxY: at.y + size - 1 }, z);
  }

  private clearYardHighlight(): void {
    for (const id of ["yard-highlight-line", "yard-highlight-fill"]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const s of ["yard-highlight", "yard-outline"]) {
      if (this.map.getSource(s)) this.map.removeSource(s);
    }
  }

  private track(id: string) {
    this.ids.push(id);
    return id;
  }

  private addSquadrats(id: string, color: string, fc: FC) {
    const src = this.track(`g14-${id}`);
    this.map.addSource(src, { type: "geojson", data: fc });
    this.map.addLayer({
      id: this.track(`g14-${id}-fill`),
      type: "fill",
      source: src,
      paint: { "fill-color": color, "fill-opacity": 0.4 },
    });
    this.map.addLayer({
      id: this.track(`g14-${id}-line`),
      type: "line",
      source: src,
      paint: { "line-color": color, "line-width": 1, "line-opacity": 0.8 },
    });
  }


  private addSquadratinhos(mask: string, color: string) {
    const src = this.track(`g17-${mask}`);
    this.map.addSource(src, { type: "geojson", data: EMPTY });
    this.map.addLayer({
      id: this.track(`g17-${mask}-fill`),
      type: "fill",
      source: src,
      minzoom: MIN_Z17_ZOOM,
      paint: { "fill-color": color, "fill-opacity": 0.45 },
    });
  }

  private updateZ17() {
    if (!this.show17 || !this.ids.length) return;
    const zoom = this.map.getZoom();
    const b = this.map.getBounds();
    const [x0, y0] = toTileCoords(b.getNorth(), b.getWest());
    const [x1, y1] = toTileCoords(b.getSouth(), b.getEast());
    const minX = Math.floor(x0);
    const maxX = Math.floor(x1);
    const minY = Math.floor(y0);
    const maxY = Math.floor(y1);

    const visible = this.people.filter((q) => q.visible);
    const masks = new Map<number, number>();
    if (zoom >= MIN_Z17_ZOOM) {
      const area = (maxX - minX + 1) * (maxY - minY + 1);
      visible.forEach((p, i) => {
        const bit = 1 << i;
        let count = 0;
        // Iterating the viewport is cheaper than the whole set only when the area is small.
        if (area < p.tiles17.size) {
          for (let x = minX; x <= maxX && count < MAX_Z17_FEATURES; x++) {
            for (let y = minY; y <= maxY; y++) {
              const k = keyOf(x, y);
              if (p.tiles17.has(k)) {
                masks.set(k, (masks.get(k) ?? 0) | bit);
                count++;
              }
            }
          }
        } else {
          for (const k of p.tiles17) {
            const x = xOf(k);
            const y = yOf(k);
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
              masks.set(k, (masks.get(k) ?? 0) | bit);
              if (++count >= MAX_Z17_FEATURES) break;
            }
          }
        }
      });
    }

    const byMask = new Map<number, FC["features"]>();
    for (const [k, mask] of masks) {
      const list = byMask.get(mask) ?? [];
      list.push(tileFeature(xOf(k), yOf(k), 17));
      byMask.set(mask, list);
    }
    for (let mask = 1; mask < 1 << visible.length; mask++) {
      const src = this.map.getSource(`g17-${mask}`) as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: byMask.get(mask) ?? [] });
    }
  }

  /** Zooms on an inclusive tile box at zoom level z. */
  fitToBox(box: { minX: number; minY: number; maxX: number; maxY: number }, z: number): void {
    const [w, n] = tileToLonLat(box.minX, box.minY, z);
    const [e, s] = tileToLonLat(box.maxX + 1, box.maxY + 1, z);
    this.map.fitBounds([[w, s], [e, n]], { padding: 150, duration: 600, maxZoom: 16 });
  }

  /** Removes the yard/uber overlay and zooms on the block of tiles with the most visited tiles. */
  async fitDensest(p: Person, z: 14 | 17): Promise<void> {
    await this.loaded;
    this.clearYardHighlight();
    const tiles = z === 17 ? p.tiles17 : p.tiles14;
    if (!tiles.size) return;
    const bin = z === 17 ? 32 : 16;
    const counts = new Map<string, number>();
    let best = "";
    let bestCount = 0;
    for (const k of tiles) {
      const id = `${Math.floor(xOf(k, z) / bin)},${Math.floor(yOf(k, z) / bin)}`;
      const c = (counts.get(id) ?? 0) + 1;
      counts.set(id, c);
      if (c > bestCount) {
        bestCount = c;
        best = id;
      }
    }
    const [bx, by] = best.split(",").map(Number);
    this.fitToBox({ minX: bx * bin, minY: by * bin, maxX: (bx + 1) * bin - 1, maxY: (by + 1) * bin - 1 }, z);
  }

  fitTo(p: Person): void {
    if (!p.tiles14.size) return;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const k of p.tiles14) {
      const [lon0, lat0] = tileToLonLat(xOf(k, 14), yOf(k, 14), 14);
      const [lon1, lat1] = tileToLonLat(xOf(k, 14) + 1, yOf(k, 14) + 1, 14);
      w = Math.min(w, lon0);
      e = Math.max(e, lon1);
      n = Math.max(n, lat0);
      s = Math.min(s, lat1);
    }
    this.map.fitBounds([[w, s], [e, n]], { padding: 40, duration: 600 });
  }
}
