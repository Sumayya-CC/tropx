import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { where, orderBy, limit, serverTimestamp } from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { Visit, VisitItem } from '../models/shop.model';
import { ActionBy } from '../models/action-by.model';

@Injectable({ providedIn: 'root' })
export class VisitService {
  private readonly firestore = inject(FirestoreService);

  /** Visits for a shop, newest first. */
  async listForShop(shopId: string, max = 50): Promise<Visit[]> {
    return firstValueFrom(this.firestore.getCollection<Visit>(
      'visits',
      where('tenantId', '==', 1),
      where('shopId', '==', shopId),
      where('isDeleted', '==', false),
      orderBy('visitDate', 'desc'),
      limit(max),
    ));
  }

  /** Most recent visit for a shop, or null. Used to auto-fill "Left". */
  async lastForShop(shopId: string): Promise<Visit | null> {
    const list = await this.listForShop(shopId, 1);
    return list[0] ?? null;
  }

  /**
   * Save a visit. For each sample item with a productId, clamp product.stock at 0
   * (matches the rest of the app) but record the FULL sampled quantity in
   * stockAdjustments so the audit trail is honest even when the counter clamps.
   */
  async saveVisit(
    shopId: string,
    shopName: string,
    payload: {
      visitDate: Date;
      items: VisitItem[];
      outcome?: string;
      managerAvailable?: boolean;
      notes?: string;
      markedConversion?: boolean;
    },
    actionBy: ActionBy,
  ): Promise<string> {
    // Compute soldSinceLastVisit per item (left - found, floored at 0).
    const items: VisitItem[] = payload.items.map(it => {
      const sold = (it.left != null && it.found != null)
        ? Math.max(0, it.left - it.found) : undefined;
      
      const item: any = { ...it, soldSinceLastVisit: sold };
      for (const key of Object.keys(item)) {
        if (item[key] === undefined) {
          delete item[key];
        }
      }
      return item as VisitItem;
    });

    let newVisitId = '';
    await this.firestore.runBatch(async (batch, db) => {
      const { collection, doc, getDoc } = await import('@angular/fire/firestore');

      const visitRef = doc(collection(db, 'visits'));
      newVisitId = visitRef.id;

      batch.set(visitRef, {
        shopId,
        visitDate: payload.visitDate,
        items,
        outcome: payload.outcome ?? null,
        managerAvailable: payload.managerAvailable ?? null,
        notes: payload.notes ?? null,
        markedConversion: payload.markedConversion ?? false,
        visitedBy: actionBy,
        tenantId: 1,
        createdAt: serverTimestamp(),
        isDeleted: false,
      });

      const shopRef = doc(db, `shops/${shopId}`);
      batch.update(shopRef, { lastVisitDate: payload.visitDate });

      // Sample stock adjustments (catalog items only).
      for (const it of items) {
        if (!it.isSample || !it.productId || !it.sampleQty || it.sampleQty <= 0) continue;
        const productRef = doc(db, `products/${it.productId}`);
        const snap = await getDoc(productRef);
        if (!snap.exists()) continue;
        const currentStock = snap.data()?.['stock'] || 0;
        const newStock = Math.max(0, currentStock - it.sampleQty);

        batch.update(productRef, { stock: newStock });

        const adjRef = doc(collection(db, 'stockAdjustments'));
        batch.set(adjRef, {
          productId: it.productId,
          productName: it.productName,
          productSku: snap.data()?.['sku'] || '',
          type: 'sample',
          quantity: -it.sampleQty,          // full honest amount
          previousStock: currentStock,
          newStock,                          // clamped
          reason: `Sample given at ${shopName}`,
          notes: it.sampleQty > currentStock
            ? `Sampled ${it.sampleQty}, stock was ${currentStock}`
            : null,
          linkedShopId: shopId,
          linkedVisitId: visitRef.id,
          adjustedBy: actionBy,
          createdAt: serverTimestamp(),
          tenantId: 1,
          isDeleted: false,
        });
      }
    });

    return newVisitId;
  }

  async updateVisit(
    visitId: string,
    shopId: string,
    payload: {
      visitDate: Date;
      items: VisitItem[];
      outcome?: string;
      managerAvailable?: boolean;
      notes?: string;
      markedConversion?: boolean;
    },
  ): Promise<void> {
    const items = payload.items.map(it => {
      const sold = (it.left != null && it.found != null)
        ? Math.max(0, it.left - it.found) : undefined;
      return { ...it, soldSinceLastVisit: sold };
    });
    await this.firestore.updateDocument(`visits/${visitId}`, {
      visitDate: payload.visitDate,
      items,
      outcome: payload.outcome ?? null,
      managerAvailable: payload.managerAvailable ?? null,
      notes: payload.notes ?? null,
      markedConversion: payload.markedConversion ?? false,
    });
    await this.recomputeShopLastVisitForShop(shopId);
  }

  async deleteVisit(
    visit: Visit,
    reverseStock: boolean,
    actionBy: ActionBy,
  ): Promise<void> {
    await this.firestore.runBatch(async (batch, db) => {
      const { doc, collection, getDoc, serverTimestamp } = await import('@angular/fire/firestore');

      batch.update(doc(db, `visits/${visit.id}`), {
        isDeleted: true,
        isDeletedAt: serverTimestamp(),
        deletedBy: actionBy,
      });

      if (reverseStock) {
        for (const it of visit.items) {
          if (!it.isSample || !it.productId || !it.sampleQty || it.sampleQty <= 0) continue;
          const pRef = doc(db, `products/${it.productId}`);
          const snap = await getDoc(pRef);
          if (!snap.exists()) continue;
          const currentStock = snap.data()?.['stock'] || 0;
          const newStock = currentStock + it.sampleQty;   // add back
          batch.update(pRef, { stock: newStock });

          const adjRef = doc(collection(db, 'stockAdjustments'));
          batch.set(adjRef, {
            productId: it.productId,
            productName: it.productName,
            productSku: snap.data()?.['sku'] || '',
            type: 'sample_reversal',
            quantity: it.sampleQty,                        // positive = added back
            previousStock: currentStock,
            newStock,
            reason: `Reversed sample from deleted visit`,
            notes: null,
            linkedShopId: visit.shopId,
            linkedVisitId: visit.id,
            adjustedBy: actionBy,
            createdAt: serverTimestamp(),
            tenantId: 1,
            isDeleted: false,
          });
        }
      }
    });
    await this.recomputeShopLastVisitForShop(visit.shopId);
  }

  /** Recompute shop.lastVisitDate from its most recent non-deleted visit. */
  async recomputeShopLastVisitForShop(shopId: string): Promise<void> {
    const list = await this.listForShop(shopId, 1); // newest non-deleted first
    const newest = list[0]?.visitDate ?? null;
    await this.firestore.updateDocument(`shops/${shopId}`, {
      lastVisitDate: newest,
    });
  }
}
