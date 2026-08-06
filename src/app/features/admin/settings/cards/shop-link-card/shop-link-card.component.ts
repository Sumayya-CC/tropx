import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirebaseApp } from '@angular/fire/app';
import { getFunctions, httpsCallable } from '@angular/fire/functions';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-shop-link-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './shop-link-card.component.html',
})
export class ShopLinkCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly functions2 = getFunctions(
    inject(FirebaseApp), 'northamerica-northeast2'
  );

  editingShopLink = signal(false);
  isSaving = signal(false);
  isReconcilingLinks = signal(false);

  shopLinkReconEnabled = signal(true);

  constructor() {
    effect(() => {
      const r = this.settings.reconciliation() as any;
      this.shopLinkReconEnabled.set(r.shopLink?.enabled !== false);
    }, { allowSignalWrites: true });
  }

  editShopLink() {
    this.editingShopLink.set(true);
  }

  cancelShopLink() {
    const r = this.settings.reconciliation() as any;
    this.shopLinkReconEnabled.set(r.shopLink?.enabled !== false);
    this.editingShopLink.set(false);
  }

  async saveShopLink() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/reconciliation', {
        shopLink: { enabled: this.shopLinkReconEnabled() },
      });
      this.toast.success('Shop ↔ customer linking settings saved');
      this.editingShopLink.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save linking settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async reconcileLinksNow() {
    this.isReconcilingLinks.set(true);
    try {
      const fn = httpsCallable(this.functions2, 'reconcileShopLinksNow');
      const res: any = await fn({});
      const d = res.data || {};
      this.toast.success(
        `Reconciled: ${d.healed ?? 0} healed, ${d.flagged ?? 0} need review, ` +
        `${d.backfilled ?? 0} backfilled (scanned ${d.scanned ?? 0})`
      );
    } catch (err) {
      console.error('Link reconcile failed', err);
      this.toast.error('Reconcile failed — check console');
    } finally {
      this.isReconcilingLinks.set(false);
    }
  }
}
