import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { feature } from "topojson-client";
import type { Person } from "./person";
import { tileToLonLat, xOf, yOf, Z_SQUADRAT } from "./tiles";

type Country = Feature<Polygon | MultiPolygon, { name: string }>;
interface Indexed {
  id: number;
  country: Country;
  bbox: [number, number, number, number];
  polys: Position[][][];
}

const loading: Partial<Record<AreaKind, Promise<Indexed[]>>> = {};

function bboxOf(polys: Position[][][]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

export type AreaKind = "countries" | "regions" | "departments";

function index(fc: FeatureCollection<Polygon | MultiPolygon, { name: string }>): Indexed[] {
  return fc.features.map((f, id) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    return { id, country: f, bbox: bboxOf(polys), polys };
  });
}

type AreaFC = FeatureCollection<Polygon | MultiPolygon, { name: string }>;

async function fetchJson(file: string): Promise<any> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
  if (!res.ok) throw new Error(`Could not load ${file}`);
  return res.json();
}

const loaders: Record<AreaKind, () => Promise<Indexed[]>> = {
  countries: async () => {
    const mod = await import("world-atlas/countries-50m.json");
    const topo = (mod.default ?? mod) as any;
    return index(feature(topo, topo.objects.countries) as unknown as AreaFC);
  },
  // Natural Earth first-level divisions (France excluded), plus French regions.
  regions: async () => {
    const [world, fr] = await Promise.all([fetchJson("regions.json"), fetchJson("fr-regions.geojson")]);
    const fc = feature(world, world.objects[Object.keys(world.objects)[0]]) as unknown as AreaFC;
    const french = (fr as FeatureCollection<Polygon | MultiPolygon, { nom: string }>).features.map((f) => ({
      ...f,
      properties: { name: f.properties.nom },
    }));
    return index({ type: "FeatureCollection", features: [...fc.features, ...french] });
  },
  departments: async () => {
    const fr = (await fetchJson("fr-departements.geojson")) as FeatureCollection<Polygon | MultiPolygon, { nom: string }>;
    return index({
      type: "FeatureCollection",
      features: fr.features.map((f) => ({ ...f, properties: { name: f.properties.nom } })),
    });
  },
};

export function loadAreas(kind: AreaKind): Promise<Indexed[]> {
  loading[kind] ??= loaders[kind]();
  return loading[kind]!;
}

export const loadCountries = () => loadAreas("countries");

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inCountry(c: Indexed, x: number, y: number): boolean {
  const [w, s, e, n] = c.bbox;
  if (x < w || x > e || y < s || y > n) return false;
  return c.polys.some((poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((hole) => inRing(x, y, hole)));
}

const visited = new WeakMap<Indexed[], WeakMap<Person, Set<number>>>();

/** Ids of the areas containing at least one squadrat of the person. */
export function visitedCountries(p: Person, countries: Indexed[]): Set<number> {
  let perPerson = visited.get(countries);
  if (!perPerson) visited.set(countries, (perPerson = new WeakMap()));
  let set = perPerson.get(p);
  if (set) return set;
  set = new Set();
  for (const k of p.tiles14) {
    const [lon, lat] = tileToLonLat(xOf(k, Z_SQUADRAT) + 0.5, yOf(k, Z_SQUADRAT) + 0.5, Z_SQUADRAT);
    for (const c of countries) {
      if (inCountry(c, lon, lat)) {
        set.add(c.id);
        break;
      }
    }
  }
  perPerson.set(p, set);
  return set;
}
