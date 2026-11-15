import { addTrack, tileToLonLat, toSquadrats, toTileCoords, xOf, yOf } from "./tiles";

export type Coordinate = [number, number]; // longitude, latitude
export type RouteMode = "loop" | "open";
export type Profile = "cycling-regular" | "foot-walking";

export interface Route {
  coordinates: Coordinate[];
  distance: number;
  tiles: Set<number>;
}

export interface RouteOptions {
  key: string;
  start: Coordinate;
  profile: Profile;
  mode: RouteMode;
  distance: number;
  z: 14 | 17;
  signal?: AbortSignal;
}

export interface RoutePlan {
  routes: Route[];
  remaining: number;
  requests: number;
  rejected: number;
  rejectionReason?: string;
}

const ENDPOINT = "https://api.openrouteservice.org/v2/directions";
const EARTH = 6_371_000;
const MAX_REQUESTS = 24;
const CANDIDATES = 4;

function distanceBetween(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(Math.min(1, h)));
}

function destination(start: Coordinate, meters: number, bearing: number): Coordinate {
  const rad = Math.PI / 180;
  const lat = start[1] * rad;
  const lon = start[0] * rad;
  const d = meters / EARTH;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(bearing));
  const nextLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(nextLat));
  return [((nextLon / rad + 540) % 360) - 180, nextLat / rad];
}

// Keep exported tracks compatible with the importer's long-GPS-gap handling.
export function densify(coordinates: Coordinate[]): Coordinate[] {
  const points: Coordinate[] = [coordinates[0]];
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1], b = coordinates[i];
    const [ax, ay] = toTileCoords(a[1], a[0]);
    const [bx, by] = toTileCoords(b[1], b[0]);
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    if (steps > 10000) throw new Error("The routing service returned an invalid or unusually long segment.");
    for (let j = 1; j <= steps; j++) {
      points.push([a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps]);
    }
  }
  return points;
}

function isCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 &&
    typeof value[0] === "number" && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
    typeof value[1] === "number" && Number.isFinite(value[1]) && Math.abs(value[1]) <= 85;
}

class CandidateError extends Error {}

async function requestRoute(options: RouteOptions, body: object): Promise<Route> {
  const response = await fetch(`${ENDPOINT}/${options.profile}/geojson`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: options.key },
    body: JSON.stringify({ ...body, instructions: false }),
    signal: options.signal,
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      throw new CandidateError(`Routing service rejected a candidate (HTTP ${response.status}).`);
    }
    throw new Error(`Routing service error (HTTP ${response.status}). Check your API key and quota.`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("features" in data) || !Array.isArray(data.features)) {
    throw new Error("The routing service returned an invalid response.");
  }
  const feature: unknown = data.features[0];
  if (!feature || typeof feature !== "object" || !("geometry" in feature) || !("properties" in feature)) {
    throw new Error("The routing service returned no route.");
  }
  const geometry = feature.geometry;
  const properties = feature.properties;
  if (!geometry || typeof geometry !== "object" || !("type" in geometry) || geometry.type !== "LineString" ||
      !("coordinates" in geometry) || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 ||
      !geometry.coordinates.every(isCoordinate) ||
      !properties || typeof properties !== "object" || !("summary" in properties) ||
      !properties.summary || typeof properties.summary !== "object" || !("distance" in properties.summary) ||
      typeof properties.summary.distance !== "number" || !Number.isFinite(properties.summary.distance) || properties.summary.distance <= 0) {
    throw new Error("The routing service returned an invalid route.");
  }
  const coordinates = densify(geometry.coordinates);
  const distance = properties.summary.distance;
  if (distance > options.distance) throw new CandidateError("Some routes exceeded the distance limit.");
  if (options.mode === "loop" && distanceBetween(coordinates[0], coordinates[coordinates.length - 1]) > 50) {
    throw new CandidateError("Some routes did not return to their starting point.");
  }
  const tiles17 = new Set<number>();
  addTrack(tiles17, coordinates.map(([lon, lat]) => [lat, lon]));
  return { coordinates, distance, tiles: options.z === 14 ? toSquadrats(tiles17) : tiles17 };
}

function countNew(route: Route, remaining: Set<number>): number {
  let count = 0;
  for (const tile of route.tiles) if (remaining.has(tile)) count++;
  return count;
}

async function evaluate(
  options: RouteOptions,
  bodies: object[],
  score: (route: Route) => number,
  plan: RoutePlan,
): Promise<Route | null> {
  let best: Route | null = null;
  let bestScore = 0;
  for (const body of bodies) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    plan.requests++;
    try {
      const route = await requestRoute(options, body);
      const value = score(route);
      if (value > bestScore || (value === bestScore && value > 0 && best && route.distance < best.distance)) {
        best = route;
        bestScore = value;
      }
    } catch (error) {
      if (!(error instanceof CandidateError)) throw error;
      plan.rejected++;
      plan.rejectionReason = error.message;
    }
  }
  return best;
}

/** Search a bounded, diverse set of routes; it does not guarantee a global optimum. */
export async function planSingle(options: RouteOptions, visited: Set<number>): Promise<RoutePlan> {
  const plan: RoutePlan = { routes: [], remaining: 0, requests: 0, rejected: 0 };
  const bodies: object[] = [];
  for (let i = 0; i < 12; i++) {
    if (options.mode === "loop") {
      bodies.push({ coordinates: [options.start], options: { round_trip: { length: options.distance * (i < 6 ? 0.8 : 0.6), points: 4, seed: i + 1 } } });
    } else {
      bodies.push({ coordinates: [options.start, destination(options.start, options.distance * (i < 6 ? 0.7 : 0.45), (i % 6) * Math.PI / 3)] });
    }
  }
  const route = await evaluate(options, bodies, (r) => {
    let score = 0;
    for (const tile of r.tiles) if (!visited.has(tile)) score++;
    return score;
  }, plan);
  if (route) plan.routes.push(route);
  return plan;
}

/** Greedily cover a selected square using at most 24 routing requests. */
export async function planSquare(options: RouteOptions, missing: number[]): Promise<RoutePlan> {
  const remaining = new Set(missing);
  const plan: RoutePlan = { routes: [], remaining: remaining.size, requests: 0, rejected: 0 };
  while (remaining.size && plan.requests < MAX_REQUESTS) {
    const targets = [...remaining].map((key) => {
      const point = tileToLonLat(xOf(key, options.z) + 0.5, yOf(key, options.z) + 0.5, options.z);
      return { point, distance: distanceBetween(options.start, point) };
    }).sort((a, b) => a.distance - b.distance);
    // Sample the nearest and more distant targets rather than repeatedly trying the same area.
    const count = Math.min(CANDIDATES, MAX_REQUESTS - plan.requests, targets.length);
    const bodies = Array.from({ length: count }, (_, i) => {
      const index = count === 1 ? 0 : Math.floor(i * (targets.length - 1) / (count - 1));
      const point = targets[index].point;
      const waypoints: Coordinate[] = [options.start, point];
      let length = distanceBetween(options.start, point);
      if (i % 2 === 1) {
        const neighbours = targets.filter((_, n) => n !== index)
          .sort((a, b) => distanceBetween(point, a.point) - distanceBetween(point, b.point));
        for (const neighbour of neighbours.slice(0, 10)) {
          const previous = waypoints[waypoints.length - 1];
          const next = length + distanceBetween(previous, neighbour.point);
          const lowerBound = next + (options.mode === "loop" ? distanceBetween(neighbour.point, options.start) : 0);
          if (lowerBound <= options.distance * 0.8) {
            waypoints.push(neighbour.point);
            length = next;
            if (waypoints.length === 4) break;
          }
        }
      }
      if (options.mode === "loop") waypoints.push(options.start);
      return { coordinates: waypoints };
    });
    const route = await evaluate(options, bodies, (r) => countNew(r, remaining), plan);
    if (!route) break;
    plan.routes.push(route);
    for (const tile of route.tiles) remaining.delete(tile);
    plan.remaining = remaining.size;
  }
  return plan;
}

export function toGpx(route: Route): string {
  const points = route.coordinates.map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Squadrats" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>Squadrats route</name><trkseg>\n${points}\n  </trkseg></trk>\n</gpx>\n`;
}
