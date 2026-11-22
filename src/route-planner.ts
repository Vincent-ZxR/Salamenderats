import { createRng, Field, nearbyUnvisited, RunState, solveBest, solveCover } from "./route-optimizer";
import { addTrack, toSquadrats, toTileCoords } from "./tiles";

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
  /** Remaining tiles estimated to be out of reach of the distance limit, or without a nearby road. */
  unreachable?: number;
}

const ENDPOINT = "https://api.heigit.org/openrouteservice/v2/directions";
const EARTH = 6_371_000;
export const MAX_SINGLE_REQUESTS = 12;
export const MAX_SQUARE_REQUESTS = 30;
// Plans target slightly under the limit because distances are estimated before the route is requested.
const LIMIT_MARGIN = 0.97;
const MAX_SINGLE_TARGETS = 1200;

function distanceBetween(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(Math.min(1, h)));
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

/** A waypoint the service could not snap to a road; `index` is its 0-based position in the request. */
class UnroutableError extends CandidateError {
  constructor(message: string, readonly index: number | null) { super(message); }
}

async function requestRoute(options: RouteOptions, waypoints: Coordinate[]): Promise<Route> {
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${options.profile}/geojson`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: options.key },
      body: JSON.stringify({ coordinates: waypoints, instructions: false }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted || !(error instanceof TypeError)) throw error;
    throw new Error("Could not reach openrouteservice. Check your internet connection, browser network restrictions, and the service's availability.");
  }
  checkAborted(options);
  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      const text = typeof response.text === "function" ? await response.text().catch(() => "") : "";
      const point = /(?:point|coordinate) (\d+)/i.exec(text);
      throw new UnroutableError(`Routing service rejected a candidate (HTTP ${response.status}).`, point ? Number(point[1]) : null);
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
  if (options.mode === "loop" && distanceBetween(coordinates[0], coordinates[coordinates.length - 1]) > 50) {
    throw new CandidateError("Some routes did not return to their starting point.");
  }
  const tiles17 = new Set<number>();
  addTrack(tiles17, coordinates.map(([lon, lat]) => [lat, lon]));
  return { coordinates, distance, tiles: options.z === 14 ? toSquadrats(tiles17) : tiles17 };
}

function countNew(route: Route, isNew: (tile: number) => boolean): number {
  let count = 0;
  for (const tile of route.tiles) if (isNew(tile)) count++;
  return count;
}

function coordinatesOf(field: Field, run: RunState, options: RouteOptions): Coordinate[] {
  const points: Coordinate[] = [options.start, ...run.waypoints.map((node) => field.lonLat(node))];
  if (options.mode === "loop") points.push(options.start);
  return points;
}

/** Brings the detour factor in line with a real route so later plans fill the distance limit accurately. */
function calibrate(field: Field, run: RunState, route: Route, limit: number): void {
  if (run.length < 50) return;
  const target = field.detour * route.distance / run.length;
  field.detour = Math.max(1, Math.min(3, route.distance > limit ? target * 1.03 : (field.detour + target) / 2));
}

/** The tile of the waypoint the service rejected, or the farthest waypoint when it did not say which. */
function unroutableTile(field: Field, run: RunState, error: CandidateError): number | null {
  const waypoints = run.waypoints;
  if (error instanceof UnroutableError && error.index !== null) {
    if (error.index === 0 || error.index > waypoints.length) {
      throw new Error("No routable road was found near the start point. Choose a start closer to a road or path.");
    }
    return field.keys[waypoints[error.index - 1]];
  }
  const farthest = [...waypoints].sort((a, b) => field.straight(0, b) - field.straight(0, a))[0];
  return farthest === undefined ? null : field.keys[farthest];
}

function checkAborted(options: RouteOptions): void {
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/**
 * Finds one run with many new tiles within the distance limit. Candidate runs are built locally from the
 * nearby unvisited tiles; only the best few are requested, and each response calibrates the estimates.
 * It does not guarantee a global optimum.
 */
export async function planSingle(options: RouteOptions, visited: Set<number>): Promise<RoutePlan> {
  const plan: RoutePlan = { routes: [], remaining: 0, requests: 0, rejected: 0 };
  const loop = options.mode === "loop";
  const tiles = nearbyUnvisited(options.start, options.z, options.distance / (loop ? 2 : 1), visited, MAX_SINGLE_TARGETS);
  if (!tiles.length) return plan;
  const field = new Field(options.start, options.z, tiles, loop, options.distance * LIMIT_MARGIN);
  const blocked = new Set<number>();
  const rng = createRng(1);
  const tried = new Set<string>();
  const isNew = (tile: number) => !visited.has(tile);
  let best: { route: Route; gain: number } | null = null;
  for (let round = 0; round < 3 && plan.requests < MAX_SINGLE_REQUESTS; round++) {
    const before = field.detour;
    const runs = solveBest(field, blocked, rng).filter((run) => !tried.has(run.route.join(","))).slice(0, 2);
    if (!runs.length) break;
    for (const run of runs) {
      if (plan.requests >= MAX_SINGLE_REQUESTS) break;
      checkAborted(options);
      tried.add(run.route.join(","));
      plan.requests++;
      let route: Route;
      try {
        route = await requestRoute(options, coordinatesOf(field, run, options));
      } catch (error) {
        if (!(error instanceof CandidateError)) throw error;
        plan.rejected++;
        plan.rejectionReason = error.message;
        const tile = unroutableTile(field, run, error);
        if (tile !== null) blocked.add(tile);
        continue;
      }
      calibrate(field, run, route, options.distance);
      if (route.distance > options.distance) {
        plan.rejected++;
        plan.rejectionReason = "Some routes exceeded the distance limit.";
        continue;
      }
      const gain = countNew(route, isNew);
      if (!best || gain > best.gain || (gain === best.gain && route.distance < best.route.distance)) best = { route, gain };
    }
    if (round > 0 && Math.abs(field.detour / before - 1) < 0.04) break;
  }
  if (best && best.gain > 0) plan.routes.push(best.route);
  return plan;
}

/**
 * Plans the fewest runs it can find to cover every missing tile of a square, all from the same start.
 * The runs are built locally; each is then requested once or twice to check and calibrate the distance,
 * and the rest is re-planned from the tiles the real route actually covered. This is a heuristic:
 * the number of runs is not guaranteed to be the minimum.
 */
export async function planSquare(options: RouteOptions, missing: number[]): Promise<RoutePlan> {
  const remaining = new Set(missing);
  const plan: RoutePlan = { routes: [], remaining: remaining.size, requests: 0, rejected: 0, unreachable: 0 };
  const field = new Field(options.start, options.z, missing, options.mode === "loop", options.distance * LIMIT_MARGIN);
  const blocked = new Set<number>();
  const misses = new Map<number, number>();
  const rng = createRng(1);
  let unreachable = new Set<number>();
  let held: { route: Route; gain: number } | null = null;
  let attempts = 0;
  let solves = 0;
  let calibrated = false;

  const accept = (route: Route) => {
    plan.routes.push(route);
    for (const tile of route.tiles) remaining.delete(tile);
    plan.remaining = remaining.size;
    held = null;
    attempts = 0;
  };

  // Before any real route is known the detour estimate is a guess, so a tile that is only
  // barely out of reach by that guess is probed once instead of being declared unreachable.
  const probe = (): RunState | undefined => {
    const slack = Math.SQRT1_2 * field.size * field.meters;
    const reach = (node: number) => (options.mode === "loop" ? 2 : 1) * Math.max(0, field.straight(0, node) - slack);
    const nodes = [...unreachable].map((tile) => field.nodeOf.get(tile)!).filter((node) => reach(node) <= options.distance);
    if (!nodes.length) return undefined;
    const node = nodes.sort((a, b) => field.straight(0, a) - field.straight(0, b))[0];
    return new RunState(field, field.loop ? [0, node, 0] : [0, node]);
  };

  while (plan.requests < MAX_SQUARE_REQUESTS) {
    checkAborted(options);
    const first = solves++ === 0;
    const solution = solveCover(field, remaining, blocked, first ? 64 : 16, rng, first ? 2500 : 600);
    unreachable = solution.unreachable;
    const run = solution.runs[0] ?? (calibrated ? undefined : probe());
    if (!run) break;
    plan.requests++;
    let route: Route;
    try {
      route = await requestRoute(options, coordinatesOf(field, run, options));
    } catch (error) {
      if (!(error instanceof CandidateError)) throw error;
      plan.rejected++;
      plan.rejectionReason = error.message;
      const tile = unroutableTile(field, run, error);
      if (tile !== null) blocked.add(tile);
      continue;
    }
    const detourBefore = field.detour;
    calibrate(field, run, route, options.distance);
    calibrated = true;
    if (route.distance > options.distance) {
      plan.rejected++;
      plan.rejectionReason = "Some routes exceeded the distance limit.";
      if (held) { accept(held.route); continue; }
      if (++attempts >= 3) {
        const tile = unroutableTile(field, run, new CandidateError("too long"));
        if (tile !== null) blocked.add(tile);
        attempts = 0;
      }
      continue;
    }
    // A waypoint the real route missed (for example because it snapped to another street) is dropped if it keeps missing.
    for (const node of run.waypoints) {
      const tile = field.keys[node];
      if (route.tiles.has(tile)) continue;
      const count = (misses.get(tile) ?? 0) + 1;
      misses.set(tile, count);
      if (count >= 2) blocked.add(tile);
    }
    const gain = countNew(route, (tile) => remaining.has(tile));
    if (gain > 0 && (!held || gain > held.gain)) held = { route, gain };
    // Re-plan with the calibrated estimate only when this run left room and the estimate changed enough to matter.
    const filled = route.distance >= 0.88 * options.distance || gain >= remaining.size;
    const stable = Math.abs(field.detour / detourBefore - 1) < 0.04;
    if (held && (filled || stable || attempts >= 2)) accept(held.route);
    else attempts++;
  }
  if (held) accept(held.route);
  plan.unreachable = [...remaining].filter((tile) => blocked.has(tile) || unreachable.has(tile)).length;
  return plan;
}

export function toGpx(route: Route): string {
  const points = route.coordinates.map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Squadrats" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>Squadrats route</name><trkseg>\n${points}\n  </trkseg></trk>\n</gpx>\n`;
}
