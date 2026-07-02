import { Injectable, inject, computed } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { Order } from '../models/order.model';
import { Product } from '../models/product.model';
import { where } from '@angular/fire/firestore';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class StockAvailabilityService {
  private firestore = inject(FirestoreService);
  private auth = inject(AuthService);

  // Only read open orders when staff is logged in.
  // This collection is not accessible to customers
  // or unauthenticated users under Firestore rules.
  private openOrders$ = toObservable(
    computed(() => this.auth.isStaff())
  ).pipe(
    switchMap(isStaff => isStaff
      ? this.firestore.getCollection<Order>(
          'orders',
          where('tenantId', '==', 1),
          where('status', 'in', ['confirmed', 'out_for_delivery'])
        )
      : of([] as Order[])
    )
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
