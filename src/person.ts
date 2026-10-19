import { computeStats, type Stats } from "./stats";
import { toSquadrats } from "./tiles";

export interface Person {
  id: string;
  name: string;
  tiles17: Set<number>;
  tiles14: Set<number>;
  stats14: Stats;
  stats17: Stats;
  color: string;
  visible: boolean;
}

export const FRIENDS = [
  { name: "Hugo", color: "#ff00cc" },
  { name: "Thomas", color: "#00c8e6" },
  { name: "Vincent", color: "#ffd400" },
] as const;

const MIXES: Record<string, string> = {
  "Hugo+Vincent": "#ff7a1a", // magenta + yellow = orange
  "Thomas+Vincent": "#3cc24a", // cyan + yellow = green
  "Hugo+Thomas": "#6a4cf0", // magenta + cyan = violet
  "Hugo+Thomas+Vincent": "#7a5c4a",
};

/** Color of a squadrat shared by the given people. */
export function mixColor(people: Pick<Person, "name" | "color">[]): string {
  if (people.length === 1) return people[0].color;
  const known = MIXES[people.map((p) => p.name).sort().join("+")];
  if (known) return known;
  const rgb = people.map((p) => [1, 3, 5].map((i) => parseInt(p.color.slice(i, i + 2), 16)));
  const avg = [0, 1, 2].map((c) => Math.round(rgb.reduce((s, v) => s + v[c], 0) / rgb.length));
  return `#${avg.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function makePerson(name: string, color: string, tiles17: Set<number>): Person {
  const tiles14 = toSquadrats(tiles17);
  return {
    id: `p-${name}`,
    name,
    tiles17,
    tiles14,
    stats14: computeStats(tiles14, 14),
    stats17: computeStats(tiles17, 17),
    color,
    visible: true,
  };
}

export function mergeInto(person: Person, extra: Set<number>): Person {
  const merged = new Set(person.tiles17);
  for (const k of extra) merged.add(k);
  const updated = makePerson(person.name, person.color, merged);
  updated.visible = person.visible;
  return updated;
}
