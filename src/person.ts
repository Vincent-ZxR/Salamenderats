import { computeStats, type Stats } from "./stats";
import { toSquadrats } from "./tiles";

export interface Activity {
  id: string;
  filename: string;
  format: "gpx" | "tcx" | "fit";
  imported: string;
  tiles17: Set<number>;
}

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
  { name: "Grégoire", color: "#1f6feb" },
  { name: "Hugo", color: "#ff8c00" },
  { name: "Thomas", color: "#e63946" },
  { name: "Vincent", color: "#2ca02c" },
] as const;

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

export function personFromActivities(person: Person, activities: Activity[]): Person {
  const tiles = new Set<number>();
  for (const activity of activities) for (const tile of activity.tiles17) tiles.add(tile);
  const updated = makePerson(person.name, person.color, tiles);
  updated.visible = person.visible;
  return updated;
}
