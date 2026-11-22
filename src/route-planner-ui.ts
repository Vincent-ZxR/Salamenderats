import type { MapView } from "./map";
import { missingTiles, type Square } from "./planner";
import type { Person } from "./person";
import { planSingle, planSquare, toGpx, type Coordinate, type Route, type RouteOptions } from "./route-planner";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupRoutePlanner(
  view: MapView,
  context: () => { person: Person | undefined; z: 14 | 17; square: Square | null },
  stopSquarePlacement: () => void,
): { invalidate: () => void; stopPlacement: () => void } {
  const key = $<HTMLInputElement>("route-key");
  const profile = $<HTMLSelectElement>("route-profile");
  const mode = $<HTMLSelectElement>("route-mode");
  const distance = $<HTMLInputElement>("route-distance");
  const place = $<HTMLButtonElement>("route-place");
  const single = $<HTMLButtonElement>("route-single");
  const square = $<HTMLButtonElement>("route-square");
  const cancel = $<HTMLButtonElement>("route-cancel");
  const status = $("route-status");
  const results = $("route-results");
  const choice = $<HTMLSelectElement>("route-choice");
  const showAll = $<HTMLInputElement>("route-show-all");
  const showAllLabel = $("route-show-all-label");
  let start: Coordinate | null = null;
  let routes: Route[] = [];
  let controller: AbortController | null = null;
  let generation = 0;
  let placing = false;

  function stopPlacement(): void {
    if (!placing) return;
    placing = false;
    place.setAttribute("aria-pressed", "false");
    place.textContent = "Choose start on map";
    view.setRouteStartPlacement(null);
  }

  function invalidate(): void {
    const hadResults = routes.length > 0 || controller !== null;
    generation++;
    controller?.abort();
    controller = null;
    single.disabled = false;
    square.disabled = false;
    cancel.hidden = true;
    routes = [];
    results.hidden = true;
    showAll.checked = false;
    if (hadResults) {
      status.textContent = "Inputs changed; calculate a new route.";
      void view.setRoute(null);
    }
  }

  place.addEventListener("click", () => {
    if (placing) {
      stopPlacement();
      return;
    }
    stopSquarePlacement();
    placing = true;
    place.setAttribute("aria-pressed", "true");
    place.textContent = "Click the map (cancel)";
    view.setRouteStartPlacement((point) => {
      stopPlacement();
      if (Math.abs(point[1]) > 85) {
        status.textContent = "Choose a start between 85° south and 85° north.";
        return;
      }
      invalidate();
      start = point;
      $("route-start-label").textContent = `Start: ${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
      void view.setRouteStart(point);
    });
  });

  for (const input of [key, profile, mode, distance]) input.addEventListener("change", invalidate);
  for (const input of [key, distance]) input.addEventListener("input", invalidate);
  cancel.addEventListener("click", () => {
    invalidate();
    status.textContent = "Route calculation cancelled.";
  });

  async function calculate(forSquare: boolean): Promise<void> {
    const { person, z, square: target } = context();
    const km = distance.valueAsNumber;
    if (!person) { status.textContent = "Choose a player above."; return; }
    if (!start) { status.textContent = "Choose a starting point on the map."; return; }
    if (!key.value.trim()) { status.textContent = "Enter your openrouteservice API key."; return; }
    if (!Number.isFinite(km) || km < 0.5 || km > 100) { status.textContent = "Enter a distance between 0.5 and 100 km."; return; }
    if (profile.value !== "cycling-regular" && profile.value !== "foot-walking") { status.textContent = "Choose an activity."; return; }
    if (mode.value !== "loop" && mode.value !== "open") { status.textContent = "Choose a route type."; return; }
    if (forSquare && !target) { status.textContent = "Suggest or place a square first."; return; }

    const visited = z === 14 ? person.tiles14 : person.tiles17;
    const missing = forSquare && target ? missingTiles(visited, target) : [];
    if (forSquare && !missing.length) { invalidate(); status.textContent = "The selected square is already complete."; return; }
    stopPlacement();
    invalidate();
    const current = generation;
    controller = new AbortController();
    const options: RouteOptions = {
      key: key.value.trim(), start, profile: profile.value, mode: mode.value,
      distance: km * 1000, z, signal: controller.signal,
    };
    single.disabled = true;
    square.disabled = true;
    cancel.hidden = false;
    status.textContent = "Calculating routes; this may take a moment…";
    try {
      const result = forSquare ? await planSquare(options, missing) : await planSingle(options, visited);
      if (generation !== current) return;
      routes = result.routes;
      const rejected = result.rejected ? ` ${result.rejected} candidates rejected or over the distance limit. ${result.rejectionReason ?? ""}` : "";
      const unreachable = result.unreachable ? ` ${result.unreachable} remaining tiles look out of reach within the distance limit, or have no road nearby.` : "";
      if (!routes.length) {
        status.textContent = `No route with new ${forSquare ? "target " : ""}tiles was found within the search and distance limits.${rejected}`;
        return;
      }
      const remaining = new Set(forSquare ? missing : []);
      choice.innerHTML = "";
      routes.forEach((route, i) => {
        let gain = 0;
        for (const tile of route.tiles) {
          if (forSquare ? remaining.delete(tile) : !visited.has(tile)) gain++;
        }
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = `${i + 1}: ${(route.distance / 1000).toFixed(1)} km · ${gain} new ${forSquare ? "target " : ""}tiles`;
        choice.append(option);
      });
      choice.value = "0";
      showAllLabel.hidden = routes.length < 2;
      results.hidden = false;
      const totalKm = (routes.reduce((sum, route) => sum + route.distance, 0) / 1000).toFixed(1);
      status.textContent = forSquare
        ? `${routes.length} runs, ${totalKm} km in total; ${result.remaining} target tiles remain. ${result.remaining ? "The objective is not complete; the number of runs is the fewest found, not proven minimal." : "All target tiles are covered; the number of runs is the fewest found, not proven minimal."} ${result.requests} requests.${unreachable}${rejected}`
        : `Best of ${result.requests} tested candidates; not guaranteed optimal.${rejected}`;
      void view.setRoute([routes[0].coordinates], true);
    } catch (error) {
      if (generation !== current) return;
      status.textContent = `Route calculation failed: ${error instanceof Error ? error.message : "unknown error"}`;
    } finally {
      if (generation === current) {
        controller = null;
        single.disabled = false;
        square.disabled = false;
        cancel.hidden = true;
      }
    }
  }

  single.addEventListener("click", () => { void calculate(false); });
  square.addEventListener("click", () => { void calculate(true); });
  choice.addEventListener("change", () => {
    const route = routes[Number(choice.value)];
    if (route && !showAll.checked) void view.setRoute([route.coordinates], true);
  });
  showAll.addEventListener("change", () => {
    const route = routes[Number(choice.value)];
    if (route) void view.setRoute(showAll.checked ? routes.map((item) => item.coordinates) : [route.coordinates], true);
  });
  $("route-download").addEventListener("click", () => {
    const index = Number(choice.value);
    const route = routes[index];
    if (!route) { status.textContent = "Select a route before downloading."; return; }
    const url = URL.createObjectURL(new Blob([toGpx(route)], { type: "application/gpx+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `squadrats-route-${index + 1}.gpx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return { invalidate, stopPlacement };
}
