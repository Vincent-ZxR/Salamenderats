import { computeStats, type Stats } from "./stats";
import { firstOfSquadrats, noteVisit, toSquadrats, type FirstSeen } from "./tiles";

export interface Person {
  id: string;
  name: string;
  tiles17: Set<number>;
  tiles14: Set<number>;
  /** Earliest visit day (days since 1970) per tile; may be missing for tiles without timestamps. */
  first17: FirstSeen;
  first14: FirstSeen;
  stats14: Stats;
  stats17: Stats;
  color: string;
  visible: boolean;
}

export const FRIENDS = [
  { name: "Hugo", color: "#ff00cc" },
  { name: "Thomas", color: "#00c8e6" },
  { name: "Vincent", color: "#ffd400" },
  { name: "Seb", color: "#ff3333" },
] as const;

export const PLAYER_COLORS = [
  { name: "Magenta", value: "#ff00cc" },
  { name: "Blue", value: "#0072b2" },
  { name: "Orange", value: "#e66100" },
  { name: "Green", value: "#009e73" },
  { name: "Purple", value: "#6a4cf0" },
  { name: "Red", value: "#e43b3b" },
  { name: "Teal", value: "#2a9d8f" },
  { name: "Cyan", value: "#00c8e6" },
  { name: "Yellow", value: "#ffd400" },
  { name: "Bright red", value: "#ff3333" },
] as const;

export function distinctPlayerColor(used: readonly string[]): string {
  const rgb = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const distance = (a: string, b: string) => {
    const first = rgb(a), second = rgb(b);
    return first.reduce((sum, value, i) => sum + (value - second[i]) ** 2, 0);
  };
  return PLAYER_COLORS.reduce((best, candidate) =>
    Math.min(...used.map((color) => distance(candidate.value, color))) >
    Math.min(...used.map((color) => distance(best.value, color))) ? candidate : best,
  PLAYER_COLORS[0]).value;
}

const MIXES: Record<string, string> = {
  "Hugo+Vincent": "#ff7a1a", // magenta + yellow = orange
  "Thomas+Vincent": "#3cc24a", // cyan + yellow = green
  "Hugo+Thomas": "#6a4cf0", // magenta + cyan = violet
  "Hugo+Thomas+Vincent": "#7a5c4a",
};

/** Color of a squadrat shared by the given people. */
export function mixColor(people: Pick<Person, "name" | "color">[]): string {
  if (people.length === 1) return people[0].color;
  const defaults = people.every((p) => FRIENDS.some((f) => f.name === p.name && f.color === p.color));
  const known = defaults && MIXES[people.map((p) => p.name).sort().join("+")];
  if (known) return known;
  const rgb = people.map((p) => [1, 3, 5].map((i) => parseInt(p.color.slice(i, i + 2), 16)));
  const avg = [0, 1, 2].map((c) => Math.round(rgb.reduce((s, v) => s + v[c], 0) / rgb.length));
  return `#${avg.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function makePerson(
  name: string,
  color: string,
  tiles17: Set<number>,
  first17: FirstSeen = new Map(),
): Person {
  const tiles14 = toSquadrats(tiles17);
  return {
    id: `p-${name}`,
    name,
    tiles17,
    tiles14,
    first17,
    first14: firstOfSquadrats(first17),
    stats14: computeStats(tiles14, 14),
    stats17: computeStats(tiles17, 17),
    color,
    visible: true,
  };
}

export function mergeInto(person: Person, extra: Set<number>, extraFirst: FirstSeen = new Map()): Person {
  const merged = new Set(person.tiles17);
  for (const k of extra) merged.add(k);
  const first = new Map(person.first17);
  for (const [k, day] of extraFirst) noteVisit(first, k, day);
  const updated = makePerson(person.name, person.color, merged, first);
  updated.visible = person.visible;
  return updated;
}
