import { describe, expect, it } from "vitest";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { visitedCountries } from "./countries";
import { keyOf, tileToLonLat } from "./tiles";

function countryAt(x: number, y: number): Feature<Polygon> {
  const [lon, lat] = tileToLonLat(x + 0.5, y + 0.5, 14);
  const ring = [
    [lon - 0.005, lat - 0.005],
    [lon + 0.005, lat - 0.005],
    [lon + 0.005, lat + 0.005],
    [lon - 0.005, lat + 0.005],
    [lon - 0.005, lat - 0.005],
  ];
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

describe("visited countries", () => {
  it("groups polygons by the visible players who visited them", () => {
    const countries: FeatureCollection<Polygon> = {
      type: "FeatureCollection",
      features: [countryAt(8390, 5495), countryAt(8391, 5495)],
    };
    const groups = visitedCountries(countries, [
      { tiles14: new Set([keyOf(8390, 5495, 14)]) },
      { tiles14: new Set([keyOf(8390, 5495, 14), keyOf(8391, 5495, 14)]) },
    ]);

    expect(groups.get(1)).toEqual([countries.features[0]]);
    expect(groups.get(3)).toEqual([countries.features[1]]);
  });

  it("does not mark countries when a visited tile is outside their polygons", () => {
    const countries: FeatureCollection<Polygon> = {
      type: "FeatureCollection",
      features: [countryAt(8390, 5495)],
    };

    expect(visitedCountries(countries, [{ tiles14: new Set([keyOf(1000, 1000, 14)]) }])).toEqual(new Map());
  });
});
