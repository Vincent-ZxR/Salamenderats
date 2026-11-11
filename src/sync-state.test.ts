import { describe, expect, it } from "vitest";
import { decodeTiles, parsePersonFile, toPersonFile } from "./codec";
import { FRIENDS, makePerson } from "./person";
import { reconcilePerson, restoreSelection } from "./sync-state";

describe("local and shared maps", () => {
  const local = makePerson("Seb", "#ff3333", new Set([1, 2]), new Map([[1, 19000]]));
  const remote = { tiles17: new Set([3]), first17: new Map([[3, 20000]]) };

  it("preserves pending imports and maps absent from the server", () => {
    expect(reconcilePerson(local, remote, true)).toBe(local);
    expect(reconcilePerson(local, undefined, false)).toBe(local);
  });

  it("restores pending imports after a browser reload", () => {
    const saved = { ...toPersonFile(local.name, local.tiles17, local.first17), pending: true };
    const file = JSON.parse(JSON.stringify(saved));
    const restored = parsePersonFile(file);
    expect(file.pending).toBe(true);
    expect(restored).toEqual({ name: "Seb", ...decodeTiles(saved.tiles17) });
    expect(reconcilePerson(makePerson(restored.name, local.color, restored.tiles17, restored.first17), remote, file.pending).tiles17).toEqual(local.tiles17);
  });

  it("applies shared replacements and changed dates once no local import is pending", () => {
    const replacement = reconcilePerson(local, remote, false);
    expect(replacement.tiles17).toEqual(remote.tiles17);
    expect(replacement.first17).toEqual(remote.first17);
    expect(reconcilePerson(local, { tiles17: local.tiles17, first17: new Map([[1, 18000]]) }, false).first17.get(1)).toBe(18000);
  });
});

describe("player selection", () => {
  const names = FRIENDS.map((friend) => friend.name);

  it("selects Seb when restoring a selection made before he was added", () => {
    expect(restoreSelection(["Hugo"], names).selected).toEqual(["Hugo", "Seb"]);
  });

  it("preserves an explicit deselection after migration", () => {
    expect(restoreSelection({ selected: ["Hugo"], known: names }, names).selected).toEqual(["Hugo"]);
  });
});
