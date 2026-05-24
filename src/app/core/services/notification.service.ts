import { Injectable, inject, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FirestoreService } from './firestore.service';
import { SettingsService } from './settings.service';
import { Return } from '../models/return.model';
import { Order } from '../models/order.model';
import { Product } from '../models/product.model';
import { where } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly firestore = inject(FirestoreService);
  private readonly settingsService = inject(SettingsService);

  private returns$ = this.firestore.getCollection<Return>(
    'returns', where('tenantId', '==', 1)
  );
  private orders$ = this.firestore.getCollection<Order>(
    'orders', where('tenantId', '==', 1)
  );
  private products$ = this.firestore.getCollection<Product>(
    'products', where('tenantId', '==', 1)
  );
  private accessRequests$ = this.firestore.getCollection<any>(
    'accessRequests', where('tenantId', '==', 1)
  );

  allReturns = toSignal(this.returns$, 
    { initialValue: [] as Return[] });
  allOrders = toSignal(this.orders$, 
    { initialValue: [] as Order[] });
  allProducts = toSignal(this.products$, 
    { initialValue: [] as Product[] });
  allAccessRequests = toSignal(this.accessRequests$,
    { initialValue: [] as any[] });

  pendingReturnsCount = computed(() =>
    this.allReturns()
      .filter(r => !r.isDeleted && r.status === 'pending')
      .length
  );

  overdueOrdersCount = computed(() => {
    const overdueDays = this.settingsService
      .ordering().overdueAfterDays || 30;
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - overdueDays);
    
    return this.allOrders().filter(o =>
      !o.isDeleted &&
      o.status !== 'cancelled' &&
      o.status !== 'delivered' &&
      (o.balanceCents || 0) > 0 &&
      (o.confirmedAt?.toDate 
        ? o.confirmedAt.toDate() 
        : new Date(o.confirmedAt)) < threshold
    ).length;
  });

  lowStockCount = computed(() =>
    this.allProducts().filter(p =>
      !p.isDeleted &&
      p.active &&
      p.stock <= (p.lowStockThreshold || 5)
    ).length
  );

  pendingAccessRequestsCount = computed(() =>
    this.allAccessRequests()
      .filter(r => r.status === 'pending')
      .length
  );
}
