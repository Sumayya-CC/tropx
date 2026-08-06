import { Component, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirebaseApp } from '@angular/fire/app';
import { getFunctions, httpsCallable } from '@angular/fire/functions';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';
import { DEFAULT_POPULAR_PRODUCTS_SETTINGS } from '../../../../../core/models/storefront-settings.model';

@Component({
  selector: 'app-popular-products-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './popular-products-card.component.html',
})
export class PopularProductsCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly functions = getFunctions(
    inject(FirebaseApp), 'northamerica-northeast1'
  );

  editingPopular = signal(false);
  isSaving = signal(false);
  isRecomputing = signal(false);

  popularEnabled = signal(true);
  popularWindowDays = signal(90);
  popularTopN = signal(10);
  popularMinPercent = signal(0);

  constructor() {
    effect(() => {
      const sf = this.settings.storefront();
      // Only sync when not actively editing (prevents Firestore listener
      // from clobbering local edits) — matches the pre-split behavior.
      if (!untracked(() => this.editingPopular())) {
        this.popularEnabled.set(sf.popularEnabled ?? true);
        const cfg = sf.popularProductsSettings ?? DEFAULT_POPULAR_PRODUCTS_SETTINGS;
        this.popularWindowDays.set(cfg.windowDays ?? 90);
        this.popularTopN.set(cfg.topN ?? 10);
        this.popularMinPercent.set(cfg.minPercent ?? 0);
      }
    }, { allowSignalWrites: true });
  }

  cancelPopular() {
    const sf = this.settings.storefront();
    this.popularEnabled.set(sf.popularEnabled ?? true);
    const cfg = sf.popularProductsSettings ?? DEFAULT_POPULAR_PRODUCTS_SETTINGS;
    this.popularWindowDays.set(cfg.windowDays ?? 90);
    this.popularTopN.set(cfg.topN ?? 10);
    this.popularMinPercent.set(cfg.minPercent ?? 0);
    this.editingPopular.set(false);
  }

  async savePopular() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/storefront', {
        popularEnabled: this.popularEnabled(),
        popularProductsSettings: {
          windowDays: this.popularWindowDays(),
          topN: this.popularTopN(),
          minPercent: this.popularMinPercent(),
        },
      });
      this.toast.success('Popular products settings saved');
      this.editingPopular.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save popular products settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async recomputePopularNow() {
    this.isRecomputing.set(true);
    try {
      const fn = httpsCallable(
        this.functions,
        'computePopularProductsNow',
        { limitedUseAppCheckTokens: false }
      );
      await fn({});
      this.toast.success('Popular products recomputed successfully');
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to recompute — check console');
    } finally {
      this.isRecomputing.set(false);
    }
  }
}
