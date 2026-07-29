import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { where, orderBy, limit } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirestoreService } from './firestore.service';
import { Visit, VisitItem } from '../models/shop.model';
import { ActionBy } from '../models/action-by.model';

@Injectable({ providedIn: 'root' })
export class VisitService {
  private readonly firestore = inject(FirestoreService);
  private readonly functions = inject(Functions);

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
   * Save a visit. Runs server-side (Admin SDK, runTransaction) rather than
   * a client writeBatch: the batch took a getDoc() read of each sampled
   * product before committing, so the read was never re-validated at
   * commit time. See saveVisit in functions/src/index.ts. shopName and
   * actionBy are no longer accepted — the server re-derives shopName from
   * a fresh shop read and actionBy from the caller's own auth token.
   */
  async saveVisit(
    shopId: string,
    payload: {
      visitDate: Date;
      items: VisitItem[];
      outcome?: string;
      managerAvailable?: boolean;
      notes?: string;
      markedConversion?: boolean;
    },
  ): Promise<string> {
    const callable = httpsCallable<
      {
        shopId: string;
        items: VisitItem[];
        outcome?: string;
        managerAvailable?: boolean;
        notes?: string;
        markedConversion?: boolean;
        visitDateMs: number;
      },
      { visitId: string }
    >(this.functions, 'saveVisit');

    const res = await callable({
      shopId,
      items: payload.items,
      outcome: payload.outcome,
      managerAvailable: payload.managerAvailable,
      notes: payload.notes,
      markedConversion: payload.markedConversion,
      visitDateMs: payload.visitDate.getTime(),
    });

    return res.data.visitId;
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
