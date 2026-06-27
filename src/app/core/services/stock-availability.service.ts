import { Injectable, inject, computed } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { Order } from '../models/order.model';
import { Product } from '../models/product.model';
import { where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class StockAvailabilityService {
  private firestore = inject(FirestoreService);

  private openOrders$ = this.firestore.getCollection<Order>(
    'orders',
    where('tenantId', '==', 1),
    where('status', 'in', ['confirmed', 'out_for_delivery'])
  );

  private openOrders = toSignal(this.openOrders$, { initialValue: [] as Order[] });

  // TODO: when settings.inventory().multiWarehouseEnabled becomes true, 
  // committed should be keyed by fulfillment warehouse once orders carry a warehouseId.
  public committedByProductId = computed(() => {
    const committed: Record<string, number> = {};
    for (const order of this.openOrders()) {
      if (order.isDeleted) continue;
      for (const item of order.items || []) {
        if (!item.productId) continue;
        if (!committed[item.productId]) {
          committed[item.productId] = 0;
        }
        committed[item.productId] += item.quantity || 0;
      }
    }
    return committed;
  });

  public committedFor(productId: string): number {
    return this.committedByProductId()[productId] || 0;
  }

  public availableFor(product: Product): number {
    return product.stock || 0;
  }

  public onHandFor(product: Product): number {
    return this.availableFor(product) + this.committedFor(product.id);
  }
}
