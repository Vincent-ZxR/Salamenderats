import { describe, expect, it } from "vitest";
import { missingTiles, suggestSquare } from "./planner";
import { keyOf } from "./tiles";

describe("square planner", () => {
  it("finds the best square anywhere and reports its missing tiles", () => {
    const tiles = new Set<number>();
    for (let x = 20; x < 43; x++) {
      for (let y = 30; y < 53; y++) {
        if (!(x === 25 && y === 35) && !(x === 40 && y === 50)) tiles.add(keyOf(x, y));
      }
    }
    tiles.add(keyOf(100, 100));
    const square = suggestSquare(tiles, 23, 17)!;
    expect(square).toEqual({ x: 20, y: 30, size: 23, z: 17 });
    expect(missingTiles(tiles, square)).toEqual([keyOf(25, 35), keyOf(40, 50)]);
    expect(missingTiles(tiles, { ...square, x: 21 })).toHaveLength(25);
  });

  it("handles empty data, ties and world edges at both tile levels", () => {
    expect(suggestSquare(new Set(), 3, 14)).toBeNull();
    for (const z of [14, 17] as const) {
      const last = 2 ** z - 1;
      const square = suggestSquare(new Set([keyOf(last, last, z), keyOf(last - 1, last, z)]), 2, z)!;
      expect(square).toEqual({ x: last - 1, y: last - 1, size: 2, z });
      expect(missingTiles(new Set([keyOf(last, last, z), keyOf(last - 1, last, z)]), square)).toHaveLength(2);
      expect(suggestSquare(new Set([keyOf(5, 5, z), keyOf(9, 9, z)]), 2, z)).toEqual({ x: 4, y: 4, size: 2, z });
    }
  });

  it("matches an exhaustive search across varied sparse tile sets", () => {
    let seed = 12345;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    for (let trial = 0; trial < 80; trial++) {
      const tiles = new Set<number>();
      for (let i = 0; i < 30; i++) tiles.add(keyOf(random() % 9, (random() >>> 8) % 9, 14));
      const size = 1 + random() % 5;
      const square = suggestSquare(tiles, size, 14)!;
      let best = -1;
      let at = { x: 0, y: 0 };
      for (let x = 0; x < 9; x++) {
        for (let y = 0; y < 9; y++) {
          const count = size * size - missingTiles(tiles, { x, y, size, z: 14 }).length;
          if (count > best) { best = count; at = { x, y }; }
        }
      }
      expect({ x: square.x, y: square.y }).toEqual(at);
    }
  });
});
