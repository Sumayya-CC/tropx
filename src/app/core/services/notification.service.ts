import { Injectable, inject, computed, signal } from '@angular/core';
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

  allReturns = signal<Return[]>([]);
  allOrders = signal<Order[]>([]);
  allProducts = signal<Product[]>([]);
  allAccessRequests = signal<any[]>([]);

  constructor() {
    this.firestore.getCollection<Return>(
      'returns', where('tenantId', '==', 1)
    ).subscribe(v => this.allReturns.set(v));

    this.firestore.getCollection<Order>(
      'orders', where('tenantId', '==', 1)
    ).subscribe(v => this.allOrders.set(v));

    this.firestore.getCollection<Product>(
      'products', where('tenantId', '==', 1)
    ).subscribe(v => this.allProducts.set(v));

    this.firestore.getCollection<any>(
      'accessRequests', where('tenantId', '==', 1)
    ).subscribe(v => this.allAccessRequests.set(v));
  }

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

  overdueOrdersList = computed(() =>
    this.allOrders()
      .filter(o =>
        !o.isDeleted &&
        o.status !== 'cancelled' &&
        o.status !== 'delivered' &&
        (o.balanceCents || 0) > 0 &&
        this.toDate(o.confirmedAt) < this.overdueThreshold()
      )
      .sort((a, b) => {
        const at = a.confirmedAt?.seconds ?? 0;
        const bt = b.confirmedAt?.seconds ?? 0;
        return at - bt; // oldest first
      })
      .slice(0, 5)
  );

  pendingReturnsList = computed(() =>
    this.allReturns()
      .filter(r =>
        !r.isDeleted && r.status === 'pending'
      )
      .sort((a, b) => {
        const at = a.createdAt?.seconds ?? 0;
        const bt = b.createdAt?.seconds ?? 0;
        return bt - at; // newest first
      })
      .slice(0, 5)
  );

  lowStockList = computed(() =>
    this.allProducts()
      .filter(p =>
        !p.isDeleted &&
        p.active &&
        p.stock <= (p.lowStockThreshold || 5)
      )
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 5)
  );

  pendingAccessRequestsList = computed(() =>
    this.allAccessRequests()
      .filter(r => r.status === 'pending')
      .sort((a: any, b: any) => {
        const at = a.submittedAt?.seconds ?? 0;
        const bt = b.submittedAt?.seconds ?? 0;
        return bt - at;
      })
      .slice(0, 3)
  );

  private overdueThreshold = computed(() => {
    const days = this.settingsService
      .ordering().overdueAfterDays || 30;
    const t = new Date();
    t.setDate(t.getDate() - days);
    return t;
  });

  private toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts.toDate) return ts.toDate();
    return new Date(ts);
  }
}
