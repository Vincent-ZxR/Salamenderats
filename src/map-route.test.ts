import { describe, expect, it, vi } from "vitest";

const map = vi.hoisted(() => ({
  addSource: vi.fn(),
  addLayer: vi.fn(),
  fitBounds: vi.fn(),
}));

vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  Popup: class {},
  NavigationControl: class {},
  LngLatBounds: class {
    points: number[][] = [];
    extend(point: number[]) { this.points.push(point); return this; }
  },
  Map: class {
    addControl() {}
    once(_event: string, callback: () => void) { callback(); }
    on() {}
    getLayer() { return undefined; }
    getSource() { return undefined; }
    addSource = map.addSource;
    addLayer = map.addLayer;
    fitBounds = map.fitBounds;
  },
}));

import { MapView } from "./map";

describe("route map preview", () => {
  it("draws separate lines and fits the bounds to every route", async () => {
    const view = new MapView({} as HTMLElement);
    const routes: [number, number][][] = [
      [[4.35, 50.85], [4.36, 50.85]],
      [[4.35, 50.85], [4.35, 50.86]],
    ];
    await view.setRoute(routes, true);

    expect(map.addSource).toHaveBeenCalledWith("route-preview", expect.objectContaining({
      data: {
        type: "FeatureCollection",
        features: routes.map((coordinates) => ({
          type: "Feature", properties: {}, geometry: { type: "LineString", coordinates },
        })),
      },
    }));
    expect(map.fitBounds).toHaveBeenCalledWith(
      expect.objectContaining({ points: routes.flat() }),
      expect.objectContaining({ padding: 45 }),
    );
  });
});
