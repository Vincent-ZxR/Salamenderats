import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeTiles } from "./codec";

const api = vi.hoisted(() => ({
  fetchMaps: vi.fn(),
  saveMap: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("./sync", () => ({ ...api, syncEnabled: true }));
vi.mock("./map", () => ({
  MapView: class {
    render() {}
    fitTo() {}
  },
}));

class Element {
  value = "";
  checked = true;
  innerHTML = "";
  textContent = "";
  files: File[] = [];
  listeners = new Map<string, (event: Event) => void>();
  addEventListener(type: string, handler: (event: Event) => void) { this.listeners.set(type, handler); }
}

class ImportWorker {
  static current: ImportWorker;
  onmessage!: (event: { data: unknown }) => void;
  onerror!: (event: { message: string }) => void;
  constructor() { ImportWorker.current = this; }
  postMessage() {}
  terminate() {}
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("import and sync", () => {
  let elements: Map<string, Element>;
  let storage: Map<string, string>;

  async function load() {
    elements = new Map();
    vi.stubGlobal("document", { getElementById: (id: string) => {
      if (!elements.has(id)) {
        const element = new Element();
        if (id === "name") element.value = "Seb";
        if (id === "replace") element.checked = false;
        elements.set(id, element);
      }
      return elements.get(id)!;
    } });
    vi.resetModules();
    await import("./main");
    await flush();
  }

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("Worker", ImportWorker);
    vi.stubGlobal("alert", vi.fn());
    api.fetchMaps.mockReset().mockResolvedValue([{ name: "Seb", tiles: encodeTiles(new Set([3])) }]);
    api.saveMap.mockReset().mockRejectedValue(new Error("unknown name"));
    api.subscribe.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps a failed import across reload even when the server has an older map", async () => {
    await load();
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    ImportWorker.current.onmessage({ data: { type: "done", tiles: [1, 2], dates: [], processed: 1, skipped: 0 } });
    await flush();
    const saved = JSON.parse(storage.get("squadrats.local")!);
    expect(saved.find((file: { name: string }) => file.name === "Seb").pending).toBe(true);

    await load();
    const restored = JSON.parse(storage.get("squadrats.local")!);
    const seb = restored.find((file: { name: string }) => file.name === "Seb");
    expect(seb.pending).toBe(true);
    expect(seb.tiles17).toBe(encodeTiles(new Set([1, 2, 3])));
    expect(api.saveMap).toHaveBeenCalledTimes(2);

    api.saveMap.mockResolvedValue(undefined);
    await load();
    const shared = JSON.parse(storage.get("squadrats.local")!).find((file: { name: string }) => file.name === "Seb");
    expect(shared.tiles17).toBe(encodeTiles(new Set([1, 2, 3])));
    expect(shared.pending).toBeUndefined();
  });

  it("ignores an older remote read that finishes after a successful import", async () => {
    let finish!: (maps: { name: string; tiles: string }[]) => void;
    api.fetchMaps.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    api.saveMap.mockResolvedValue(undefined);
    await load();
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    ImportWorker.current.onmessage({ data: { type: "done", tiles: [1, 2], dates: [], processed: 1, skipped: 0 } });
    await flush();
    finish([{ name: "Seb", tiles: encodeTiles(new Set([3])) }]);
    await flush();
    const seb = JSON.parse(storage.get("squadrats.local")!).find((file: { name: string }) => file.name === "Seb");
    expect(seb.tiles17).toBe(encodeTiles(new Set([1, 2])));
    expect(seb.pending).toBeUndefined();
  });

  it("retries an empty replacement without restoring the previous shared map", async () => {
    await load();
    (document.getElementById("replace") as HTMLInputElement).checked = true;
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    ImportWorker.current.onmessage({ data: { type: "done", tiles: [], dates: [], processed: 1, skipped: 0 } });
    await flush();
    await load();
    const seb = JSON.parse(storage.get("squadrats.local")!).find((file: { name: string }) => file.name === "Seb");
    expect(seb.tiles17).toBe("");
    expect(seb.pending).toBe(true);
  });

  it("shares the latest import when another import finishes during a save", async () => {
    let finish!: () => void;
    api.saveMap.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    api.saveMap.mockResolvedValue(undefined);
    await load();
    const importTiles = (tiles: number[]) => {
      elements.get("files")!.files = [{} as File];
      elements.get("files")!.listeners.get("change")!(new Event("change"));
      ImportWorker.current.onmessage({ data: { type: "done", tiles, dates: [], processed: 1, skipped: 0 } });
    };
    importTiles([1]);
    await flush();
    importTiles([2]);
    await flush();
    finish();
    await flush();
    expect(api.saveMap).toHaveBeenCalledTimes(2);
    expect(api.saveMap).toHaveBeenLastCalledWith("Seb", encodeTiles(new Set([1, 2, 3])));
    const seb = JSON.parse(storage.get("squadrats.local")!).find((file: { name: string }) => file.name === "Seb");
    expect(seb.pending).toBeUndefined();
  });
});
