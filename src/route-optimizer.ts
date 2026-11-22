import { addSegment, keyOf, tileToLonLat, toTileCoords, xOf, yOf, Z_SHIFT, Z_SQUADRATINHO } from "./tiles";

// Local route search. Distances are estimated as straight lines times a detour factor that the caller
// calibrates against real routing responses, so only a few routing requests are needed.

export const MAX_WAYPOINTS = 46; // the routing service accepts 50 coordinates including the start and end
export const DEFAULT_DETOUR = 1.3;
const EQUATOR = 40_075_016.686;
// A straight segment only counts as covering a tile when it passes near the tile's centre, since the real route follows streets.
const NEAR = 0.35;

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function groundScale(lat: number): number {
  return EQUATOR * Math.cos(lat * Math.PI / 180) / 2 ** Z_SQUADRATINHO;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Nearest unvisited tiles within straight-line reach of the start. */
export function nearbyUnvisited(
  start: [number, number],
  z: 14 | 17,
  reach: number,
  visited: Set<number>,
  max: number,
): number[] {
  const size = 2 ** (Z_SQUADRATINHO - z);
  const meters = groundScale(start[1]);
  const [sx, sy] = toTileCoords(start[1], start[0]);
  const radius = Math.min(150, Math.ceil(reach / (size * meters)));
  const cx = Math.floor(sx / size), cy = Math.floor(sy / size);
  const world = 2 ** z;
  const found: { key: number; d: number }[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= world || y >= world) continue;
      const key = keyOf(x, y, z);
      if (visited.has(key)) continue;
      const d = Math.hypot((x + 0.5) * size - sx, (y + 0.5) * size - sy) * meters;
      if (d <= reach) found.push({ key, d });
    }
  }
  return found.sort((a, b) => a.d - b.d).slice(0, max).map((tile) => tile.key);
}

/** The start (node 0) and the candidate tile centres (nodes 1..n), with distance estimates and tile coverage. */
export class Field {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly keys: number[] = [-1];
  readonly nodeOf = new Map<number, number>();
  readonly size: number;
  readonly meters: number;
  readonly startKey: number;
  detour: number;
  private readonly raw: Float64Array;
  private readonly segments = new Map<number, number[]>();

  constructor(
    readonly start: [number, number],
    readonly z: 14 | 17,
    tiles: Iterable<number>,
    readonly loop: boolean,
    public limit: number,
    detour = DEFAULT_DETOUR,
  ) {
    this.detour = detour;
    this.size = 2 ** (Z_SQUADRATINHO - z);
    this.meters = groundScale(start[1]);
    const [sx, sy] = toTileCoords(start[1], start[0]);
    this.xs.push(sx);
    this.ys.push(sy);
    this.startKey = keyOf(Math.floor(sx / this.size), Math.floor(sy / this.size), z);
    for (const key of tiles) {
      this.nodeOf.set(key, this.xs.length);
      this.keys.push(key);
      this.xs.push((xOf(key, z) + 0.5) * this.size);
      this.ys.push((yOf(key, z) + 0.5) * this.size);
    }
    const n = this.xs.length;
    this.raw = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(this.xs[i] - this.xs[j], this.ys[i] - this.ys[j]) * this.meters;
        this.raw[i * n + j] = d;
        this.raw[j * n + i] = d;
      }
    }
  }

  get nodes(): number { return this.xs.length; }

  straight(i: number, j: number): number { return this.raw[i * this.xs.length + j]; }

  dist(i: number, j: number): number { return this.raw[i * this.xs.length + j] * this.detour; }

  lonLat(node: number): [number, number] { return tileToLonLat(this.xs[node], this.ys[node], Z_SQUADRATINHO); }

  private tileAt(node: number): number {
    return keyOf(Math.floor(this.xs[node] / this.size), Math.floor(this.ys[node] / this.size), this.z);
  }

  /** Tiles a straight segment between two nodes is assumed to cover. */
  segment(i: number, j: number): number[] {
    const a = Math.min(i, j), b = Math.max(i, j);
    const id = a * this.xs.length + b;
    const cached = this.segments.get(id);
    if (cached) return cached;
    const covered = new Set<number>([this.tileAt(a), this.tileAt(b)]);
    const crossed = new Set<number>();
    addSegment(crossed, this.xs[a], this.ys[a], this.xs[b], this.ys[b]);
    const checked = new Set<number>();
    for (const tile of crossed) {
      const key = this.z === Z_SQUADRATINHO ? tile : keyOf(xOf(tile) >> Z_SHIFT, yOf(tile) >> Z_SHIFT, this.z);
      if (checked.has(key)) continue;
      checked.add(key);
      const cx = (xOf(key, this.z) + 0.5) * this.size;
      const cy = (yOf(key, this.z) + 0.5) * this.size;
      if (distanceToSegment(cx, cy, this.xs[a], this.ys[a], this.xs[b], this.ys[b]) <= NEAR * this.size) covered.add(key);
    }
    const tiles = [...covered];
    this.segments.set(id, tiles);
    return tiles;
  }
}

interface Insertion { cost: number; pos: number }

/** One run: the start, an ordered list of waypoints and, for loops, the start again. */
export class RunState {
  route: number[];
  length = 0;
  covered = new Set<number>();

  constructor(readonly field: Field, route?: number[]) {
    this.route = route ?? (field.loop ? [0, 0] : [0]);
    this.recompute();
  }

  clone(): RunState { return new RunState(this.field, [...this.route]); }

  get waypoints(): number[] { return this.route.filter((node) => node !== 0); }

  private recompute(): void {
    let length = 0;
    const covered = new Set<number>([this.field.startKey]);
    for (let i = 0; i + 1 < this.route.length; i++) {
      length += this.field.dist(this.route[i], this.route[i + 1]);
      for (const tile of this.field.segment(this.route[i], this.route[i + 1])) covered.add(tile);
    }
    this.length = length;
    this.covered = covered;
  }

  /** Cheapest feasible position for a waypoint, or null if the distance limit or waypoint cap would be exceeded. */
  bestInsertion(node: number): Insertion | null {
    if (this.route.length - (this.field.loop ? 2 : 1) >= MAX_WAYPOINTS) return null;
    const { field, route } = this;
    let best: Insertion | null = null;
    for (let p = 0; p + 1 < route.length; p++) {
      const a = route[p], b = route[p + 1];
      const cost = field.dist(a, node) + field.dist(node, b) - field.dist(a, b);
      if (this.length + cost <= field.limit && (!best || cost < best.cost)) best = { cost, pos: p + 1 };
    }
    if (!field.loop) {
      const cost = field.dist(route[route.length - 1], node);
      if (this.length + cost <= field.limit && (!best || cost < best.cost)) best = { cost, pos: route.length };
    }
    return best;
  }

  insert(node: number, pos: number): void {
    this.route.splice(pos, 0, node);
    this.recompute();
  }

  /** Repeatedly adds the uncovered candidate that is cheapest to fit in. */
  fill(candidates: readonly number[], rng: Rng, noise: number): void {
    let pool = candidates;
    for (;;) {
      pool = pool.filter((node) => !this.covered.has(this.field.keys[node]));
      let bestScore = Infinity, bestNode = -1, bestPos = 0;
      for (const node of pool) {
        const insertion = this.bestInsertion(node);
        if (!insertion) continue;
        const score = noise ? insertion.cost * (1 + noise * rng()) : insertion.cost;
        if (score < bestScore) {
          bestScore = score;
          bestNode = node;
          bestPos = insertion.pos;
        }
      }
      if (bestNode < 0) return;
      this.insert(bestNode, bestPos);
    }
  }

  private coverageOf(route: number[]): Set<number> {
    const covered = new Set<number>([this.field.startKey]);
    for (let i = 0; i + 1 < route.length; i++) {
      for (const tile of this.field.segment(route[i], route[i + 1])) covered.add(tile);
    }
    return covered;
  }

  /** 2-opt: reverses stretches of the waypoint order while that shortens the run and keeps every wanted tile covered. */
  improve(wanted: (tile: number) => boolean): void {
    const { field, route } = this;
    const last = route.length - 1;
    const end = field.loop ? last - 1 : last;
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 1; i < end; i++) {
        for (let j = i + 1; j <= end; j++) {
          let delta = field.dist(route[i - 1], route[j]) - field.dist(route[i - 1], route[i]);
          if (j < last) delta += field.dist(route[i], route[j + 1]) - field.dist(route[j], route[j + 1]);
          if (delta >= -1e-6) continue;
          const reverse = () => { for (let a = i, b = j; a < b; a++, b--) [route[a], route[b]] = [route[b], route[a]]; };
          reverse();
          const covered = this.coverageOf(route);
          let keeps = true;
          for (const tile of this.covered) if (wanted(tile) && !covered.has(tile)) { keeps = false; break; }
          if (!keeps) { reverse(); continue; }
          this.covered = covered;
          improved = true;
        }
      }
    }
    this.recompute();
  }

  optimize(candidates: readonly number[], rng: Rng, noise: number, wanted: (tile: number) => boolean): void {
    this.fill(candidates, rng, noise);
    this.improve(wanted);
    this.fill(candidates, rng, noise);
    this.improve(wanted);
  }
}

export interface CoverSolution {
  runs: RunState[];
  /** Tiles that cannot be reached within the distance limit even by a dedicated run (estimated). */
  unreachable: Set<number>;
}

function totalLength(runs: RunState[]): number {
  return runs.reduce((sum, run) => sum + run.length, 0);
}

/** Tries to remove a run by fitting its tiles into the others. */
function eliminate(runs: RunState[], required: Set<number>, field: Field): RunState[] {
  const wanted = (tile: number) => required.has(tile);
  let current = runs;
  let progress = true;
  while (current.length > 1 && progress) {
    progress = false;
    const share = (run: RunState) => [...run.covered].filter((tile) => required.has(tile)).length;
    for (const victim of [...current].sort((a, b) => share(a) - share(b))) {
      const others = current.filter((run) => run !== victim).map((run) => run.clone());
      const need: number[] = [];
      for (const tile of required) {
        const node = field.nodeOf.get(tile);
        if (node !== undefined && !others.some((run) => run.covered.has(tile))) need.push(node);
      }
      need.sort((a, b) => field.straight(0, b) - field.straight(0, a));
      let ok = true;
      for (const node of need) {
        if (others.some((run) => run.covered.has(field.keys[node]))) continue;
        let best: { run: RunState; insertion: Insertion } | null = null;
        for (const run of others) {
          const insertion = run.bestInsertion(node);
          if (insertion && (!best || insertion.cost < best.insertion.cost)) best = { run, insertion };
        }
        if (!best) { ok = false; break; }
        best.run.insert(node, best.insertion.pos);
      }
      if (ok) {
        for (const run of others) run.improve(wanted);
        current = others;
        progress = true;
        break;
      }
    }
  }
  return current;
}

/**
 * Searches for the fewest runs, then the shortest total distance, that cover every remaining tile.
 * This is NP-hard, so it is a multi-start heuristic: farthest-first construction, cheapest insertion,
 * 2-opt and run elimination. The result is not guaranteed minimal.
 */
export function solveCover(
  field: Field,
  remaining: Set<number>,
  blocked: Set<number>,
  iterations: number,
  rng: Rng,
  budgetMs = 3000,
): CoverSolution {
  const unreachable = new Set<number>();
  const nodes: number[] = [];
  const required = new Set<number>();
  const empty = new RunState(field);
  for (const tile of remaining) {
    const node = field.nodeOf.get(tile);
    if (node === undefined || blocked.has(tile)) continue;
    if (!empty.bestInsertion(node)) { unreachable.add(tile); continue; }
    nodes.push(node);
    required.add(tile);
  }
  if (!nodes.length) return { runs: [], unreachable };

  let best: RunState[] | null = null;
  let bestScore = Infinity;
  const deadline = Date.now() + budgetMs;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const noise = iteration === 0 ? 0 : 0.2;
    const left = new Set(required);
    let candidates = nodes;
    const runs: RunState[] = [];
    while (candidates.length) {
      const ranked = [...candidates].sort((a, b) => field.straight(0, b) - field.straight(0, a));
      const seed = iteration === 0 ? ranked[0] : ranked[Math.floor(rng() * Math.min(ranked.length, 1 + (iteration % 5)))];
      const run = new RunState(field);
      run.insert(seed, run.bestInsertion(seed)!.pos);
      run.optimize(candidates, rng, noise, (tile) => required.has(tile));
      runs.push(run);
      for (const tile of run.covered) left.delete(tile);
      candidates = candidates.filter((node) => left.has(field.keys[node]));
    }
    const reduced = eliminate(runs, required, field);
    const score = reduced.length * 1e9 + totalLength(reduced);
    if (score < bestScore) {
      best = reduced;
      bestScore = score;
    }
    if (Date.now() > deadline) break;
  }
  const share = (run: RunState) => [...run.covered].filter((tile) => required.has(tile)).length;
  return { runs: best!.sort((a, b) => share(b) - share(a)), unreachable };
}

/** Candidate single runs, best estimated first: each maximises the number of candidate tiles within the distance limit. */
export function solveBest(field: Field, blocked: Set<number>, rng: Rng, seeds = 8): RunState[] {
  const nodes: number[] = [];
  for (let node = 1; node < field.nodes; node++) if (!blocked.has(field.keys[node])) nodes.push(node);
  if (!nodes.length) return [];
  const density = new Map<number, number>();
  const radius = 2.5 * field.size * field.meters;
  for (const a of nodes) {
    let count = 0;
    for (const b of nodes) if (field.straight(a, b) <= radius) count++;
    density.set(a, count);
  }
  const empty = new RunState(field);
  const ranked = nodes
    .filter((node) => empty.bestInsertion(node))
    .sort((a, b) => density.get(b)! / (1 + field.dist(0, b) / field.limit) - density.get(a)! / (1 + field.dist(0, a) / field.limit));
  const spread: number[] = [];
  for (const node of ranked) {
    if (spread.length >= seeds) break;
    if (spread.every((other) => field.straight(node, other) > field.limit / (field.loop ? 8 : 6))) spread.push(node);
  }

  const results: RunState[] = [];
  for (const seed of [null, ...spread]) {
    const run = new RunState(field);
    if (seed !== null) run.insert(seed, run.bestInsertion(seed)!.pos);
    run.optimize(nodes, rng, 0, (tile) => field.nodeOf.has(tile));
    results.push(run);
  }
  const score = (run: RunState) => [...run.covered].filter((tile) => field.nodeOf.has(tile)).length;
  const seen = new Set<string>();
  return results
    .sort((a, b) => score(b) - score(a) || a.length - b.length)
    .filter((run) => {
      const signature = run.route.join(",");
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
}
