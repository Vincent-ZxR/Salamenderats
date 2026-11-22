import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGpx } from "./parse";
import { planSingle, planSquare, toGpx, type Coordinate, type RouteOptions } from "./route-planner";
import { addTrack, keyOf, tileToLonLat, toTileCoords } from "./tiles";

const start: Coordinate = [4.35, 50.85];
const options: RouteOptions = {
  key: "test-key", start, profile: "cycling-regular", mode: "open", distance: 5000, z: 17,
};

function response(coordinates: Coordinate[], distance = 1000, status = 200): Response {
  return new Response(JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "LineString", coordinates }, properties: { summary: { distance } } }],
  }), { status, headers: { "Content-Type": "application/json" } });
}

function metres(coordinates: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lon0, lat0] = coordinates[i - 1], [lon1, lat1] = coordinates[i];
    const rad = Math.PI / 180;
    const dx = (lon1 - lon0) * rad * Math.cos(lat0 * rad), dy = (lat1 - lat0) * rad;
    total += 6_371_000 * Math.hypot(dx, dy);
  }
  return total;
}

/** A router that follows the requested waypoints in straight lines, optionally stretched like real streets. */
function router(stretch = 1) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const coordinates = JSON.parse(String(init.body)).coordinates as Coordinate[];
    return response(coordinates, metres(coordinates) * stretch);
  });
}

const [x, y] = toTileCoords(start[1], start[0]).map(Math.floor);
const tilesAt = (cells: [number, number][]) => cells.map(([dx, dy]) => keyOf(x + dx, y + dy));

afterEach(() => vi.unstubAllGlobals());

describe("route planning", () => {
  it("plans one route from the nearby unvisited tiles within the distance limit", async () => {
    const fetchMock = router();
    vi.stubGlobal("fetch", fetchMock);
    const visited = new Set<number>();
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) visited.add(keyOf(x + dx, y + dy));
    const result = await planSingle({ ...options, mode: "loop", distance: 8000 }, visited);
    expect(result.routes).toHaveLength(1);
    const route = result.routes[0];
    expect(route.distance).toBeLessThanOrEqual(8000);
    expect([...route.tiles].filter((tile) => !visited.has(tile)).length).toBeGreaterThan(20);
    expect(result.requests).toBeLessThanOrEqual(12);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.heigit.org/openrouteservice/v2/directions/cycling-regular/geojson");
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("test-key");
    const waypoints = JSON.parse(String(fetchMock.mock.calls[0][1].body)).coordinates as Coordinate[];
    expect(waypoints[0]).toEqual(start);
    expect(waypoints[waypoints.length - 1]).toEqual(start);
  });

  it("covers separate clusters with one run each when they cannot share a run", async () => {
    vi.stubGlobal("fetch", router());
    const missing = tilesAt([[20, 0], [21, 0], [22, 0], [-20, 0], [-21, 0], [-22, 0], [0, 20], [0, 21], [0, 22]]);
    const result = await planSquare({ ...options, mode: "loop", distance: 10000 }, missing);
    expect(result.remaining).toBe(0);
    expect(result.routes).toHaveLength(3);
    for (const route of result.routes) expect(route.distance).toBeLessThanOrEqual(10000);
    expect(result.requests).toBeLessThanOrEqual(30);
  });

  it("covers a compact block in a single run", async () => {
    vi.stubGlobal("fetch", router());
    const missing: number[] = [];
    for (let dx = 4; dx <= 8; dx++) for (let dy = -1; dy <= 1; dy++) missing.push(keyOf(x + dx, y + dy));
    const result = await planSquare({ ...options, mode: "loop", distance: 8000 }, missing);
    expect(result.remaining).toBe(0);
    expect(result.routes).toHaveLength(1);
  });

  it("recalibrates when real routes are longer than estimated and never suggests an over-long run", async () => {
    vi.stubGlobal("fetch", router(1.8));
    const missing: number[] = [];
    for (let dx = 6; dx <= 9; dx++) for (let dy = 0; dy <= 3; dy++) missing.push(keyOf(x + dx, y + dy));
    const result = await planSquare({ ...options, mode: "loop", distance: 8000 }, missing);
    expect(result.rejected).toBeGreaterThan(0);
    expect(result.routes.length).toBeGreaterThan(1);
    for (const route of result.routes) expect(route.distance).toBeLessThanOrEqual(8000);
    expect(result.remaining).toBe(0);
  });

  it("does not request tiles that are too far for the distance limit", async () => {
    const fetchMock = router();
    vi.stubGlobal("fetch", fetchMock);
    const result = await planSquare(options, tilesAt([[100, 0]]));
    expect(result.routes).toHaveLength(0);
    expect(result.remaining).toBe(1);
    expect(result.unreachable).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a waypoint the service cannot snap to a road and keeps planning", async () => {
    let calls = 0;
    const waypoints: Coordinate[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const coordinates = JSON.parse(String(init.body)).coordinates as Coordinate[];
      waypoints.push(coordinates);
      if (++calls === 1) {
        return new Response(JSON.stringify({ error: { code: 2010, message: "Could not find point 1: 4.36 50.85 within a radius of 350.0 meters." } }), { status: 404 });
      }
      return response(coordinates, metres(coordinates));
    }));
    const missing = tilesAt([[3, 0], [4, 0], [5, 0], [6, 0]]);
    const result = await planSquare({ ...options, mode: "loop" }, missing);
    expect(result.rejected).toBe(1);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(waypoints.slice(1).some((points) => points.some((point) => point[0] === waypoints[0][1][0] && point[1] === waypoints[0][1][1]))).toBe(false);
  });

  it("explains when the start is not near a road", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Could not find point 0: 4.35 50.85 within a radius of 350.0 meters." } }), { status: 404 })));
    await expect(planSquare(options, tilesAt([[3, 0]]))).rejects.toThrow("near the start");
  });

  it("surfaces quota errors instead of presenting a partial plan as complete", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([], 0, 429)));
    await expect(planSingle(options, new Set())).rejects.toThrow("HTTP 429");
  });

  it("explains network failures without treating them as rejected candidates", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(planSingle({ ...options, profile: "foot-walking", mode: "loop", distance: 10000 }, new Set()))
      .rejects.toThrow("Could not reach openrouteservice");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops an aborted search without issuing another request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      return response([start, [4.351, 50.85]]);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(planSingle({ ...options, signal: controller.signal }, new Set())).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exports a GPX whose reimport visits the same tiles, even for long route segments", async () => {
    const end = tileToLonLat(x + 20.5, y + 0.5, 17);
    vi.stubGlobal("fetch", vi.fn(async () => response([start, end])));
    const result = await planSingle(options, new Set());
    const route = result.routes[0];
    const imported = new Set<number>();
    addTrack(imported, parseGpx(toGpx(route)));
    expect(imported).toEqual(route.tiles);
    expect(imported.size).toBeGreaterThan(5);
  });
});
