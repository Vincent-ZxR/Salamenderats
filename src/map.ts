import type { Feature, FeatureCollection, Polygon } from "geojson";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Person } from "./person";
import { keyOf, toTileCoords, tileToLonLat, xOf, yOf } from "./tiles";

// Bundlers don't emit MapLibre's worker file, so point it at an explicitly bundled copy.
maplibregl.setWorkerUrl(workerUrl);

type FC = FeatureCollection<Polygon>;
const EMPTY: FC = { type: "FeatureCollection", features: [] };
const MIN_Z17_ZOOM = 12;
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

export class MapView {
  readonly map: maplibregl.Map;
  private loaded: Promise<void>;
  private ids: string[] = [];
  private people: Person[] = [];
  private show14 = true;
  private show17 = true;
  private fc14 = new WeakMap<Person, FC>();

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
    this.loaded = new Promise((r) => this.map.once("load", () => r()));
    this.map.on("moveend", () => this.updateZ17());
  }

  async render(people: Person[], show14: boolean, show17: boolean): Promise<void> {
    await this.loaded;
    this.people = people;
    this.show14 = show14;
    this.show17 = show17;

    for (const id of this.ids) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of this.ids) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
    this.ids = [];

    for (const p of people.filter((q) => q.visible)) {
      if (show14) this.addSquadrats(p);
      if (show17) this.addSquadratinhos(p);
    }
    this.updateZ17();
  }

  private track(id: string) {
    this.ids.push(id);
    return id;
  }

  private addSquadrats(p: Person) {
    let fc = this.fc14.get(p);
    if (!fc) {
      fc = toCollection(p.tiles14, 14);
      this.fc14.set(p, fc);
    }
    const src = this.track(`${p.id}-14`);
    this.map.addSource(src, { type: "geojson", data: fc });
    this.map.addLayer({
      id: this.track(`${p.id}-14-fill`),
      type: "fill",
      source: src,
      paint: { "fill-color": p.color, "fill-opacity": 0.3 },
    });
    this.map.addLayer({
      id: this.track(`${p.id}-14-line`),
      type: "line",
      source: src,
      paint: { "line-color": p.color, "line-width": 1, "line-opacity": 0.7 },
    });

    const sq = p.stats14.maxSquareAt;
    if (sq && p.stats14.maxSquare > 1) {
      const sqSrc = this.track(`${p.id}-sq`);
      this.map.addSource(sqSrc, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [tileFeature(sq.x, sq.y, 14, p.stats14.maxSquare)] },
      });
      this.map.addLayer({
        id: this.track(`${p.id}-sq-line`),
        type: "line",
        source: sqSrc,
        paint: { "line-color": p.color, "line-width": 3 },
      });
    }
  }

  private addSquadratinhos(p: Person) {
    const src = this.track(`${p.id}-17`);
    this.map.addSource(src, { type: "geojson", data: EMPTY });
    this.map.addLayer({
      id: this.track(`${p.id}-17-fill`),
      type: "fill",
      source: src,
      minzoom: MIN_Z17_ZOOM,
      paint: { "fill-color": p.color, "fill-opacity": 0.45 },
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

    for (const p of this.people.filter((q) => q.visible)) {
      const src = this.map.getSource(`${p.id}-17`) as maplibregl.GeoJSONSource | undefined;
      if (!src) continue;
      if (zoom < MIN_Z17_ZOOM) {
        src.setData(EMPTY);
        continue;
      }
      const features: FC["features"] = [];
      // Iterating the viewport is cheaper than the whole set only when the area is small.
      const area = (maxX - minX + 1) * (maxY - minY + 1);
      if (area < p.tiles17.size) {
        for (let x = minX; x <= maxX && features.length < MAX_Z17_FEATURES; x++) {
          for (let y = minY; y <= maxY; y++) {
            if (p.tiles17.has(keyOf(x, y))) features.push(tileFeature(x, y, 17));
          }
        }
      } else {
        for (const k of p.tiles17) {
          const x = xOf(k);
          const y = yOf(k);
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            features.push(tileFeature(x, y, 17));
            if (features.length >= MAX_Z17_FEATURES) break;
          }
        }
      }
      src.setData({ type: "FeatureCollection", features });
    }
  }

  /** Zooms on an inclusive tile box at zoom level z. */
  fitToBox(box: { minX: number; minY: number; maxX: number; maxY: number }, z: number): void {
    const [w, n] = tileToLonLat(box.minX, box.minY, z);
    const [e, s] = tileToLonLat(box.maxX + 1, box.maxY + 1, z);
    this.map.fitBounds([[w, s], [e, n]], { padding: 60, duration: 600, maxZoom: 17 });
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
