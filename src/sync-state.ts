import { makePerson, type Person } from "./person";
import type { FirstSeen } from "./tiles";

export function reconcilePerson(
  person: Person,
  remote: { tiles17: Set<number>; first17: FirstSeen } | undefined,
  pending: boolean,
): Person {
  if (pending || !remote) return person;
  const sameTiles = person.tiles17.size === remote.tiles17.size && [...person.tiles17].every((tile) => remote.tiles17.has(tile));
  const sameDates = person.first17.size === remote.first17.size &&
    [...person.first17].every(([tile, day]) => remote.first17.get(tile) === day);
  if (sameTiles && sameDates) return person;
  const replacement = makePerson(person.name, person.color, remote.tiles17, remote.first17);
  replacement.visible = person.visible;
  return replacement;
}

export interface PlayerSelection {
  selected: string[];
  known: string[];
}

export function restoreSelection(saved: unknown, names: readonly string[]): PlayerSelection {
  if (Array.isArray(saved)) {
    const selected = saved.filter((name): name is string => typeof name === "string");
    // The original selection format predates Seb.
    const known = ["Hugo", "Thomas", "Vincent", ...selected];
    return { selected: names.filter((name) => selected.includes(name) || !known.includes(name)), known: [...names] };
  }
  if (saved && typeof saved === "object" && "selected" in saved && "known" in saved &&
      Array.isArray(saved.selected) && Array.isArray(saved.known)) {
    const { selected, known } = saved;
    return {
      selected: names.filter((name) => selected.includes(name) || !known.includes(name)),
      known: [...names],
    };
  }
  return { selected: [...names], known: [...names] };
}
