import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeTiles } from "./codec";

const api = vi.hoisted(() => ({
  fetchMaps: vi.fn(),
  saveMap: vi.fn(),
  subscribe: vi.fn(),
  setPlanner: vi.fn(),
  setPlannerPlacement: vi.fn(),
  account: { id: "account-1", name: "Seb" } as { id: string; name: string } | null,
}));

vi.mock("./sync", () => ({ fetchMaps: api.fetchMaps, saveMap: api.saveMap, subscribe: api.subscribe, syncEnabled: true }));
vi.mock("./account", () => ({ setupAccount: (onReady: (id: string, name: string) => Promise<void>) =>
  api.account ? onReady(api.account.id, api.account.name) : Promise.resolve() }));
vi.mock("./map", () => ({
  MapView: class {
    render() {}
    fitTo() {}
    setPlanner = api.setPlanner;
    setPlannerPlacement = api.setPlannerPlacement;
  },
}));

class Element {
  value = "";
  checked = true;
  innerHTML = "";
  textContent = "";
  hidden = false;
  disabled = false;
  files: File[] = [];
  listeners = new Map<string, (event: Event) => void>();
  addEventListener(type: string, handler: (event: Event) => void) { this.listeners.set(type, handler); }
  closest(_selector: string): Element | null { return null; }
  setAttribute() {}
  get valueAsNumber() { return Number(this.value); }
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
  let windowListeners: Map<string, EventListener>;

  async function load() {
    elements = new Map();
    vi.stubGlobal("document", { getElementById: (id: string) => {
      if (!elements.has(id)) {
        const element = new Element();
        if (id === "name") element.value = "Seb";
        if (id === "plan-size") element.value = "23";
        if (id === "plan-type") element.value = "17";
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
    windowListeners = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", { addEventListener: (type: string, handler: EventListener) => windowListeners.set(type, handler), setInterval: vi.fn() });
    vi.stubGlobal("Element", Element);
    vi.stubGlobal("Worker", ImportWorker);
    vi.stubGlobal("alert", vi.fn());
    api.fetchMaps.mockReset().mockResolvedValue([{ id: "account-1", username: "Seb", tiles: encodeTiles(new Set([3])) }]);
    api.saveMap.mockReset().mockRejectedValue(new Error("unknown name"));
    api.account = { id: "account-1", name: "Seb" };
    api.subscribe.mockReset();
    api.setPlanner.mockReset();
    api.setPlannerPlacement.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps a failed import across reload even when the server has an older map", async () => {
    await load();
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    ImportWorker.current.onmessage({ data: { type: "done", tiles: [1, 2], dates: [], processed: 1, skipped: 0 } });
    await flush();
    const saved = JSON.parse(storage.get("squadrats.local.account-1")!);
    expect(saved.find((file: { name: string }) => file.name === "Seb").pending).toBe(true);

    await load();
    const restored = JSON.parse(storage.get("squadrats.local.account-1")!);
    const seb = restored.find((file: { name: string }) => file.name === "Seb");
    expect(seb.pending).toBe(true);
    expect(seb.tiles17).toBe(encodeTiles(new Set([1, 2, 3])));
    expect(api.saveMap).toHaveBeenCalledTimes(2);

    api.saveMap.mockResolvedValue(undefined);
    await load();
    const shared = JSON.parse(storage.get("squadrats.local.account-1")!).find((file: { name: string }) => file.name === "Seb");
    expect(shared.tiles17).toBe(encodeTiles(new Set([1, 2, 3])));
    expect(shared.pending).toBeUndefined();
  });

  it("ignores an older remote read that finishes after a successful import", async () => {
    let finish!: (maps: { id: string; username: string; tiles: string }[]) => void;
    api.saveMap.mockResolvedValue(undefined);
    await load();
    api.fetchMaps.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    windowListeners.get("focus")!(new Event("focus"));
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    ImportWorker.current.onmessage({ data: { type: "done", tiles: [1, 2], dates: [], processed: 1, skipped: 0 } });
    await flush();
    finish([{ id: "account-1", username: "Seb", tiles: encodeTiles(new Set([4])) }]);
    await flush();
    const seb = JSON.parse(storage.get("squadrats.local.account-1")!).find((file: { name: string }) => file.name === "Seb");
    expect(seb.tiles17).toBe(encodeTiles(new Set([1, 2, 3])));
    expect(seb.pending).toBeUndefined();
  });

  it("waits for the first remote map before allowing an import", async () => {
    let finish!: (maps: { id: string; username: string; tiles: string }[]) => void;
    api.fetchMaps.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await load();
    expect(elements.get("open-import")!.disabled).toBe(true);
    finish([{ id: "account-1", username: "Seb", tiles: encodeTiles(new Set([3])) }]);
    await flush();
    expect(elements.get("open-import")!.disabled).toBe(false);
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    ImportWorker.current.onmessage({ data: { type: "done", tiles: [1], dates: [], processed: 1, skipped: 0 } });
    expect(JSON.parse(storage.get("squadrats.local.account-1")!)[0].tiles17).toBe(encodeTiles(new Set([1, 3])));
  });

  it("retries an empty replacement without restoring the previous shared map", async () => {
    await load();
    (document.getElementById("replace") as HTMLInputElement).checked = true;
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    ImportWorker.current.onmessage({ data: { type: "done", tiles: [], dates: [], processed: 1, skipped: 0 } });
    await flush();
    await load();
    const seb = JSON.parse(storage.get("squadrats.local.account-1")!).find((file: { name: string }) => file.name === "Seb");
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
    expect(api.saveMap).toHaveBeenLastCalledWith(encodeTiles(new Set([1, 2, 3])));
    const seb = JSON.parse(storage.get("squadrats.local.account-1")!).find((file: { name: string }) => file.name === "Seb");
    expect(seb.pending).toBeUndefined();
  });

  it("plans for the chosen player, adjusts placement and updates after an import", async () => {
    await load();
    elements.get("plan-size")!.value = "2";
    elements.get("plan-find")!.listeners.get("click")!(new Event("click"));
    expect(elements.get("plan-result")!.textContent).toBe("Seb: 1 of 4 visited · 3 missing");
    const initial = api.setPlanner.mock.lastCall![0];
    expect(initial.square).toEqual({ x: 0, y: 2, size: 2, z: 17 });
    elements.get("plan-place")!.listeners.get("click")!(new Event("click"));
    const place = api.setPlannerPlacement.mock.lastCall![0];
    place(0, 0);
    expect(elements.get("plan-result")!.textContent).toBe("Seb: 0 of 4 visited · 4 missing");
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    ImportWorker.current.onmessage({ data: { type: "done", tiles: [1], dates: [], processed: 1, skipped: 0 } });
    expect(elements.get("plan-result")!.textContent).toBe("Seb: 1 of 4 visited · 3 missing");
  });

  it("moves an active square one tile with arrow keys without hijacking form controls", async () => {
    await load();
    elements.get("plan-size")!.value = "2";
    elements.get("plan-find")!.listeners.get("click")!(new Event("click"));
    const target = new Element();
    vi.spyOn(target, "closest").mockImplementation((selector) => selector === ".planner, #map" ? target : null);
    const key = (name: string, element: Element) => {
      const event = new Event("keydown", { cancelable: true });
      Object.defineProperties(event, { key: { value: name }, target: { value: element } });
      windowListeners.get("keydown")!(event);
      return event;
    };
    expect(key("ArrowRight", target).defaultPrevented).toBe(true);
    expect(api.setPlanner.mock.lastCall![0].square).toEqual({ x: 1, y: 2, size: 2, z: 17 });
    expect(elements.get("plan-result")!.textContent).toBe("Seb: 0 of 4 visited · 4 missing");
    expect(key("ArrowDown", target).defaultPrevented).toBe(true);
    expect(api.setPlanner.mock.lastCall![0].square).toEqual({ x: 1, y: 3, size: 2, z: 17 });

    const field = new Element();
    vi.spyOn(field, "closest").mockReturnValue(field);
    const count = api.setPlanner.mock.calls.length;
    expect(key("ArrowUp", field).defaultPrevented).toBe(false);
    expect(api.setPlanner.mock.calls.length).toBe(count);
    elements.get("plan-clear")!.listeners.get("click")!(new Event("click"));
    expect(key("ArrowUp", target).defaultPrevented).toBe(false);
  });

  it("removes a former friend's map on refresh without saving it locally", async () => {
    api.fetchMaps.mockResolvedValue([
      { id: "account-1", username: "Seb", tiles: encodeTiles(new Set([3])) },
      { id: "account-2", username: "friend", tiles: encodeTiles(new Set([5])) },
    ]);
    await load();
    expect(elements.get("players")!.innerHTML).toContain("friend");
    expect(storage.get("squadrats.local.account-1")).not.toContain("friend");
    api.fetchMaps.mockResolvedValue([{ id: "account-1", username: "Seb", tiles: encodeTiles(new Set([3])) }]);
    windowListeners.get("focus")!(new Event("focus"));
    await flush();
    expect(elements.get("players")!.innerHTML).not.toContain("friend");
    expect(elements.get("plan-person")!.innerHTML).not.toContain("friend");
  });

  it("does not claim legacy or another account's saved maps", async () => {
    storage.set("squadrats.local", JSON.stringify([{ version: 1, name: "Seb", tiles17: encodeTiles(new Set([99])) }]));
    storage.set("squadrats.local.account-2", JSON.stringify([{ version: 1, name: "Seb", tiles17: encodeTiles(new Set([98])), pending: true }]));
    await load();
    const saved = JSON.parse(storage.get("squadrats.local.account-1")!);
    expect(saved[0].tiles17).toBe(encodeTiles(new Set([3])));
    expect(api.saveMap).not.toHaveBeenCalled();
  });

  it("does not allow importing before signing in", async () => {
    api.account = null;
    await load();
    expect(elements.get("open-import")!.disabled).toBe(true);
    elements.get("files")!.files = [{} as File];
    elements.get("files")!.listeners.get("change")!(new Event("change"));
    expect(api.saveMap).not.toHaveBeenCalled();
    expect(elements.get("progress")!.textContent).toContain("Sign in");
  });
});
