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

afterEach(() => vi.unstubAllGlobals());

describe("route planning", () => {
  it("chooses the candidate with the most new tiles, respecting the distance limit and route profile", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body));
      expect(body.coordinates[0]).toEqual(start);
      if (calls === 1) return response([start, [4.36, 50.85]], 6000);
      if (calls === 2) return response([start, [4.355, 50.85]], 2000);
      return response([start, [4.351, 50.85]], 1000);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await planSingle(options, new Set());
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].distance).toBe(2000);
    expect(result.rejected).toBe(1);
    expect(result.requests).toBe(12);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.heigit.org/openrouteservice/v2/directions/cycling-regular/geojson");
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("test-key");
  });

  it("counts square coverage cumulatively, uses loops and respects the request budget", async () => {
    const [x, y] = toTileCoords(start[1], start[0]).map(Math.floor);
    const missing = [keyOf(x + 2, y), keyOf(x - 2, y), keyOf(x, y + 2)];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const coordinates = JSON.parse(String(init.body)).coordinates as Coordinate[];
      expect(coordinates[0]).toEqual(start);
      expect(coordinates[coordinates.length - 1]).toEqual(start);
      return response(coordinates);
    }));
    const result = await planSquare({ ...options, mode: "loop" }, missing);
    const covered = new Set(result.routes.flatMap((route) => [...route.tiles]));
    expect(result.remaining).toBe(missing.filter((tile) => !covered.has(tile)).length);
    expect(result.remaining).toBe(0);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.requests).toBeLessThanOrEqual(24);
  });

  it("requests varied round trips and rejects a route that does not return", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson");
      const body = JSON.parse(String(init.body));
      expect(body.coordinates).toEqual([start]);
      expect(body.options.round_trip.length).toBeLessThan(options.distance);
      expect(body.options.round_trip.seed).toBe(++calls);
      const end: Coordinate = [4.36, 50.85];
      return response(calls === 1 ? [start, end] : [start, end, start]);
    }));
    const result = await planSingle({ ...options, profile: "foot-walking", mode: "loop" }, new Set());
    expect(result.routes).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });

  it("reports incomplete coverage when candidates cannot reach the target", async () => {
    const [x, y] = toTileCoords(start[1], start[0]).map(Math.floor);
    vi.stubGlobal("fetch", vi.fn(async () => response([start, [4.351, 50.85]], 9000)));
    const result = await planSquare(options, [keyOf(x + 10, y)]);
    expect(result.routes).toHaveLength(0);
    expect(result.remaining).toBe(1);
    expect(result.rejected).toBe(1);
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
    const [x, y] = toTileCoords(start[1], start[0]).map(Math.floor);
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
