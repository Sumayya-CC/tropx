import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { Shop } from '../models/shop.model';
import { Order } from '../models/order.model';
import { RouteStop, LatLng, optimizeRoute, routeDistanceKm, chunkForNavigation, googleMapsUrl } from '../../shared/utils/geo.utils';

@Injectable({ providedIn: 'root' })
export class RoutingService {
  private readonly firestore = inject(FirestoreService);

  /** Deliverable orders (not delivered/cancelled) with a resolvable shop coordinate. */
  async deliveryStops(serviceAreaIds: string[] | null): Promise<RouteStop[]> {
    const orders = await firstValueFrom(this.firestore.getCollection<Order>(
      'orders',
      where('tenantId', '==', 1),
      where('status', 'in', ['confirmed', 'preparing', 'out_for_delivery']),
    ));
    // Group by customer/shop; need coordinates from the linked shop or customer.
    // Customers carry coordinates; orders carry customerId + serviceAreaId.
    const customers = await firstValueFrom(this.firestore.getCollection<any>(
      'customers', where('tenantId', '==', 1), where('isDeleted', '==', false),
    ));
    const custById = new Map(customers.map((c: any) => [c.id, c]));

    const byCustomer = new Map<string, RouteStop>();
    for (const o of orders) {
      if (o.isDeleted) continue;
      if (serviceAreaIds && serviceAreaIds.length && !serviceAreaIds.includes((o as any).serviceAreaId)) continue;
      const c: any = custById.get(o.customerId);
      const coords: LatLng | undefined = c?.coordinates;
      if (!coords?.lat || !coords?.lng) continue; // missing location → excluded from routing
      const existing = byCustomer.get(o.customerId);
      if (existing) {
        existing.orderIds!.push(o.id);
        existing.amountCents! += o.totalCents || 0;
      } else {
        byCustomer.set(o.customerId, {
          id: c.id, name: c.businessName || o.customerName, coordinates: coords,
          kind: 'customer', orderIds: [o.id], amountCents: o.totalCents || 0,
          street: c.address?.street, city: c.address?.city, preferCoordinatesForNav: c.preferCoordinatesForNav ?? false,
          linkedShopId: c.linkedShopId ?? undefined,
        });
      }
    }
    return [...byCustomer.values()];
  }

  /** All shops (customers + prospects) in the given service areas, with coordinates. */
  async visitStops(serviceAreaIds: string[] | null): Promise<RouteStop[]> {
    const shops = await firstValueFrom(this.firestore.getCollection<Shop>(
      'shops', where('tenantId', '==', 1), where('isDeleted', '==', false),
    ));
    return shops
      .filter(s => (s.coordinates as any)?.lat && (s.coordinates as any)?.lng)
      .filter(s => !serviceAreaIds || serviceAreaIds.length === 0 || (s.serviceAreaId && serviceAreaIds.includes(s.serviceAreaId)))
      .map(s => ({
        id: s.id, name: s.name, coordinates: s.coordinates as LatLng,
        kind: s.status === 'customer' ? 'customer' as const : 'prospect' as const,
        healthBand: s.healthBand,
        street: s.address?.street, city: s.address?.city, preferCoordinatesForNav: s.preferCoordinatesForNav ?? false,
        linkedCustomerId: s.linkedCustomerId ?? undefined,
      }));
  }

  optimize(start: LatLng, stops: RouteStop[], returnToStart: boolean): RouteStop[] {
    return optimizeRoute(start, stops, returnToStart);
  }
  distanceKm(start: LatLng, stops: RouteStop[], returnToStart: boolean): number {
    return routeDistanceKm(start, stops, returnToStart);
  }
  /** Build chunked Google Maps URLs. Leg N starts from the previous leg's last stop (or start). */
  navigationLegs(start: LatLng, ordered: RouteStop[], maxPerLeg: number, travelMode: string, returnToStart: boolean, forceCoordinates: boolean = false): { url: string; stops: RouteStop[] }[] {
    const legs = chunkForNavigation(ordered, maxPerLeg);
    const result: { url: string; stops: RouteStop[] }[] = [];
    let origin = start;
    legs.forEach((leg, idx) => {
      const isLast = idx === legs.length - 1;
      const finalDest = (isLast && returnToStart) ? start : undefined;
      result.push({ url: googleMapsUrl(origin, leg, travelMode, forceCoordinates, finalDest), stops: leg });
      origin = leg[leg.length - 1].coordinates; // next leg continues from here
    });
    return result;
  }
}
