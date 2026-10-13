import { describe, expect, it } from "vitest";
import { decodeKeys, encodeKeys } from "./codec";
import { parseGpx, parseTcx } from "./parse";
import { computeStats } from "./stats";
import { addTrack, keyOf, toSquadrats, toTileCoords } from "./tiles";

describe("tiles", () => {
  it("maps Brussels to the known zoom-14 tile", () => {
    const [x, y] = toTileCoords(50.8503, 4.3517);
    expect([Math.floor(x) >> 3, Math.floor(y) >> 3]).toEqual([8390, 5495]);
  });

  it("interpolates fast segments so no tile is skipped", () => {
    const tiles = new Set<number>();
    addTrack(tiles, [
      [50.85, 4.35],
      [50.85, 4.37],
    ]);
    expect(tiles.size).toBeGreaterThan(5);
  });

  it("derives zoom-14 squadrats from zoom-17 tiles", () => {
    const s = toSquadrats([keyOf(8, 8), keyOf(15, 15), keyOf(16, 8)]);
    expect(s.size).toBe(2);
  });
});

describe("stats", () => {
  it("finds max square and cluster", () => {
    const keys = new Set<number>();
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) keys.add(keyOf(x, y, 14));
    keys.add(keyOf(10, 10, 14));
    const s = computeStats(keys, 14);
    expect(s.maxSquare).toBe(3);
    expect(s.maxSquareAt).toEqual({ x: 0, y: 0 });
    expect(s.maxCluster).toBe(9);
    expect(s.maxClusterBox).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 2 });
    expect(s.count).toBe(10);
  });
});

describe("codec", () => {
  it("round-trips keys", () => {
    const keys = new Set([5, 1_000_000, 17_000_000_000, 3, 131072 * 70000 + 12345]);
    expect(decodeKeys(encodeKeys(keys))).toEqual(keys);
  });
});

describe("parsers", () => {
  it("reads GPX track points", () => {
    const gpx = `<gpx><trk><trkseg><trkpt lat="50.1" lon="4.2"><ele>1</ele></trkpt><trkpt lon='4.3' lat='50.2'/></trkseg></trk></gpx>`;
    expect([...parseGpx(gpx)].filter((p) => !Number.isNaN(p[0]))).toEqual([
      [50.1, 4.2],
      [50.2, 4.3],
    ]);
  });

  it("reads TCX positions", () => {
    const tcx = `<Position><LatitudeDegrees>50.1</LatitudeDegrees><LongitudeDegrees>4.2</LongitudeDegrees></Position>`;
    expect([...parseTcx(tcx)]).toEqual([[50.1, 4.2]]);
  });
});
