import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { Person } from "./person";
import { tileToLonLat, xOf, yOf } from "./tiles";

type CountryGeometry = Polygon | MultiPolygon;
type Ring = Position[];
type PolygonRings = Ring[];

function polygonsOf(geometry: CountryGeometry): PolygonRings[] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function boundsOf(geometry: CountryGeometry): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      for (const position of ring) {
        minX = Math.min(minX, position[0]);
        minY = Math.min(minY, position[1]);
        maxX = Math.max(maxX, position[0]);
        maxY = Math.max(maxY, position[1]);
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

function ringContains(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry: CountryGeometry, x: number, y: number): boolean {
  return polygonsOf(geometry).some(
    ([outer, ...holes]) => outer && ringContains(outer, x, y) && !holes.some((hole) => ringContains(hole, x, y)),
  );
}

/** Groups country polygons by the mask of visible players who have visited them. */
export function visitedCountries(
  countries: FeatureCollection<CountryGeometry>,
  players: Pick<Person, "tiles14">[],
): Map<number, Feature<CountryGeometry>[]> {
  const groups = new Map<number, Feature<CountryGeometry>[]>();
  const visits = players.map((person) =>
    [...person.tiles14].map((key) => tileToLonLat(xOf(key, 14) + 0.5, yOf(key, 14) + 0.5, 14)),
  );

  for (const feature of countries.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const [minX, minY, maxX, maxY] = boundsOf(geometry);
    let mask = 0;
    for (let i = 0; i < visits.length; i++) {
      if (
        visits[i].some(
          ([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY && geometryContains(geometry, x, y),
        )
      ) {
        mask |= 1 << i;
      }
    }
    if (!mask) continue;
    const group = groups.get(mask) ?? [];
    group.push(feature);
    groups.set(mask, group);
  }
  return groups;
}
