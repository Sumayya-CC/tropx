export interface LatLng { lat: number; lng: number; }

export interface RouteStop {
  id: string;              // shop id
  name: string;
  coordinates: LatLng;
  kind: 'customer' | 'prospect';
  // optional payload for display
  orderIds?: string[];
  amountCents?: number;
  healthBand?: string;
  street?: string;
  city?: string;
  preferCoordinatesForNav?: boolean;
  linkedShopId?: string;
  linkedCustomerId?: string;
}

/** Great-circle distance in km between two points. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function toRad(d: number): number { return (d * Math.PI) / 180; }

/** Total path length in km through stops in the given order (optionally returning to start). */
export function routeDistanceKm(start: LatLng, stops: RouteStop[], returnToStart: boolean): number {
  if (stops.length === 0) return 0;
  let total = haversineKm(start, stops[0].coordinates);
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversineKm(stops[i].coordinates, stops[i + 1].coordinates);
  }
  if (returnToStart) total += haversineKm(stops[stops.length - 1].coordinates, start);
  return total;
}

/** Nearest-neighbor ordering from a start point. */
export function nearestNeighborOrder(start: LatLng, stops: RouteStop[]): RouteStop[] {
  const remaining = [...stops];
  const ordered: RouteStop[] = [];
  let current = start;
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i].coordinates);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = next.coordinates;
  }
  return ordered;
}

/** 2-opt improvement pass — cheap for <=~25 stops. Reduces total distance via segment reversals. */
export function twoOptImprove(start: LatLng, stops: RouteStop[], returnToStart: boolean): RouteStop[] {
  if (stops.length < 4) return stops;
  let best = [...stops];
  let bestDist = routeDistanceKm(start, best, returnToStart);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const d = routeDistanceKm(start, candidate, returnToStart);
        if (d < bestDist - 1e-9) { best = candidate; bestDist = d; improved = true; }
      }
    }
  }
  return best;
}

/** Full optimization: nearest-neighbor seed + 2-opt polish. */
export function optimizeRoute(start: LatLng, stops: RouteStop[], returnToStart: boolean): RouteStop[] {
  const seed = nearestNeighborOrder(start, stops);
  return twoOptImprove(start, seed, returnToStart);
}

/** Split an ordered stop list into legs of <= maxPerLeg for Google Maps handoff. */
export function chunkForNavigation<T>(stops: T[], maxPerLeg: number): T[][] {
  const legs: T[][] = [];
  for (let i = 0; i < stops.length; i += maxPerLeg) {
    legs.push(stops.slice(i, i + maxPerLeg));
  }
  return legs;
}

/**
 * Build a Google Maps directions URL for one leg.
 * origin = the point you start this leg from; destination = last stop; middle = waypoints.
 */
export function navToken(stop: RouteStop, forceCoordinates: boolean): string {
  const useCoords = forceCoordinates || stop.preferCoordinatesForNav
    || (!stop.street && !stop.city);   // no address → must use coords
  if (useCoords) return `${stop.coordinates.lat},${stop.coordinates.lng}`;
  // Address text: "Business Name, Street, City"
  const parts = [stop.name, stop.street, stop.city].filter(Boolean);
  return parts.join(', ');
}

export function googleMapsUrl(
  origin: LatLng, legStops: RouteStop[], travelMode = 'driving',
  forceCoordinates = false, finalDestination?: LatLng,
): string {
  if (legStops.length === 0) return '';
  const originToken = `${origin.lat},${origin.lng}`; // start is always coords (a saved point/current loc)
  const destStop = legStops[legStops.length - 1];
  const destToken = finalDestination
    ? `${finalDestination.lat},${finalDestination.lng}`
    : navToken(destStop, forceCoordinates);
  const waypointStops = finalDestination ? legStops : legStops.slice(0, -1);
  const waypoints = waypointStops.map(s => navToken(s, forceCoordinates)).join('|');
  const params = new URLSearchParams({
    api: '1', origin: originToken, destination: destToken, travelmode: travelMode,
  });
  let url = `https://www.google.com/maps/dir/?${params.toString()}`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  return url;
}

export function findNearbyShops(
  routeStops: RouteStop[],
  candidates: RouteStop[],
  radiusKm: number,
): { shop: RouteStop; nearestKm: number }[] {
  const out: { shop: RouteStop; nearestKm: number }[] = [];
  for (const cand of candidates) {
    let nearest = Infinity;
    for (const r of routeStops) {
      const d = haversineKm(cand.coordinates, r.coordinates);
      if (d < nearest) nearest = d;
    }
    if (nearest <= radiusKm) out.push({ shop: cand, nearestKm: nearest });
  }
  return out.sort((a, b) => a.nearestKm - b.nearestKm);
}
