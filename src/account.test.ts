import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  fetchMaps: vi.fn(),
  fetchRelationships: vi.fn(),
  watchSession: vi.fn(),
}));

vi.mock("./sync", () => ({
  ...api,
  acceptFriend: vi.fn(),
  createProfile: vi.fn(),
  removeFriend: vi.fn(),
  requestFriend: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));

import { setupAccount } from "./account";

class Element {
  hidden = true;
  textContent = "";
  addEventListener() {}
  replaceChildren() {}
}

let elements: Map<string, Element>;

beforeEach(() => {
  elements = new Map();
  vi.stubGlobal("document", { getElementById: (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  } });
  vi.stubGlobal("window", { addEventListener: vi.fn(), setInterval: vi.fn() });
  api.getSession.mockReset();
  api.fetchMaps.mockReset();
  api.fetchRelationships.mockReset();
  api.watchSession.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

it("offers account navigation without exposing friends when signed out", async () => {
  api.getSession.mockResolvedValue(null);
  await setupAccount(vi.fn(), vi.fn());
  expect(elements.get("nav-account")!.hidden).toBe(false);
  expect(elements.get("auth-form")!.hidden).toBe(false);
  expect(elements.get("account-status")!.textContent).toContain("Sign in");
  expect(elements.has("nav-friends")).toBe(false);
});

it("offers friends navigation after profile setup without opening the section", async () => {
  api.getSession.mockResolvedValue({ user: { id: "1", email: "test@example.com" } });
  api.fetchMaps.mockResolvedValue([{ id: "1", username: "test" }]);
  api.fetchRelationships.mockResolvedValue([]);
  const ready = vi.fn();
  await setupAccount(ready, vi.fn());
  expect(elements.get("nav-friends")!.hidden).toBe(false);
  expect(elements.has("friends-panel")).toBe(false);
  expect(ready).toHaveBeenCalledWith("1", "test");
});
