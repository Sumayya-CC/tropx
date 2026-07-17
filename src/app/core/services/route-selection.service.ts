import { Injectable, signal } from '@angular/core';

/** Holds shop ids picked on the field map, to hand off to the route planner. */
@Injectable({ providedIn: 'root' })
export class RouteSelectionService {
  readonly pendingShopIds = signal<string[]>([]);

  toggle(id: string) {
    this.pendingShopIds.update(ids =>
      ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }
  has(id: string): boolean { return this.pendingShopIds().includes(id); }
  clear() { this.pendingShopIds.set([]); }
  count(): number { return this.pendingShopIds().length; }
}
