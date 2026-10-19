import { describe, expect, it } from "vitest";
import { decodeKeys, encodeKeys } from "./codec";
import { parseGpx, parseTcx, virtualActivityFiles } from "./parse";
import { computeStats } from "./stats";
import { addSegment, addTrack, keyOf, toSquadrats, toTileCoords } from "./tiles";

describe("tiles", () => {
  it("maps Brussels to the known zoom-14 tile", () => {
    const [x, y] = toTileCoords(50.8503, 4.3517);
    expect([Math.floor(x) >> 3, Math.floor(y) >> 3]).toEqual([8390, 5495]);
  });

  it("interpolates fast segments so no tile is skipped", () => {
    const tiles = new Set<number>();
    addTrack(tiles, [
      [50.85, 4.35],
      [50.85, 4.357],
    ]);
    expect(tiles.size).toBeGreaterThan(3);
  });

  it("does not bridge GPS dropouts longer than a few tiles", () => {
    const tiles = new Set<number>();
    addTrack(tiles, [
      [50.85, 4.35],
      [50.85, 4.37],
    ]);
    expect(tiles.size).toBe(2);
  });

  it("counts a tile whose corner is only barely clipped by a segment", () => {
    const tiles = new Set<number>();
    addSegment(tiles, 0.6, 1.39, 1.49, 0.5);
    expect(tiles).toEqual(new Set([keyOf(0, 1), keyOf(0, 0), keyOf(1, 0)]));
  });

  it("counts tiles crossed by segments shorter than one tile", () => {
    const tiles = new Set<number>();
    addSegment(tiles, 0.95, 0.5, 1.05, 0.5);
    expect(tiles).toEqual(new Set([keyOf(0, 0), keyOf(1, 0)]));
  });

  it("derives zoom-14 squadrats from zoom-17 tiles", () => {
    const s = toSquadrats([keyOf(8, 8), keyOf(15, 15), keyOf(16, 8)]);
    expect(s.size).toBe(2);
  });
});

describe("stats", () => {
  it("finds max square and yard tiles with all four neighbours visited", () => {
    const keys = new Set<number>();
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) keys.add(keyOf(x, y, 14));
    keys.add(keyOf(10, 10, 14));
    const s = computeStats(keys, 14);
    expect(s.maxSquare).toBe(3);
    expect(s.maxSquareAt).toEqual({ x: 0, y: 0 });
    expect(s.maxCluster).toBe(1);
    expect(s.maxClusterTiles).toEqual([keyOf(1, 1, 14)]);
    expect(s.maxClusterBox).toEqual({ minX: 1, minY: 1, maxX: 1, maxY: 1 });
    expect(s.count).toBe(10);
  });

  it("counts a connected 3-by-3 interior yard inside a visited 5-by-5 block", () => {
    const keys = new Set<number>();
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) keys.add(keyOf(x, y, 14));
    const s = computeStats(keys, 14);
    expect(s.maxCluster).toBe(9);
    expect(s.maxClusterTiles).toHaveLength(9);
    expect(s.maxClusterBox).toEqual({ minX: 1, minY: 1, maxX: 3, maxY: 3 });
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

  it("lists virtual activity files from activities.csv", () => {
    const csv =
      'Activity ID,Activity Name,Activity Type,Activity Description,Filename\r\n' +
      '1,"Zwift, ""Watopia""",Virtual Ride,"multi\nline",activities/1.fit.gz\r\n' +
      "2,Morning,Ride,,activities/2.fit.gz\r\n";
    expect(virtualActivityFiles(csv)).toEqual(new Set(["activities/1.fit.gz"]));
  });

  it("detects virtual rides in a French archive", () => {
    const csv =
      "ID de l'activité,Date de l'activité,Nom de l'activité,Type d'activité,Description de l'activité,Temps écoulé,Distance,Nom du fichier\n" +
      '13521689820,"2 févr. 2025, 16:37:48",Zwift - Orientation,Vélo virtuel,"",1585,"13,34",activities/14424833569.fit.gz\n' +
      '2,"3 févr. 2025, 10:00:00",Sortie,Vélo,"",1585,"13,34",activities/2.fit.gz\n';
    expect(virtualActivityFiles(csv)).toEqual(new Set(["activities/14424833569.fit.gz"]));
  });

  it("reads TCX positions", () => {
    const tcx = `<Position><LatitudeDegrees>50.1</LatitudeDegrees><LongitudeDegrees>4.2</LongitudeDegrees></Position>`;
    expect([...parseTcx(tcx)]).toEqual([[50.1, 4.2]]);
  });
});
