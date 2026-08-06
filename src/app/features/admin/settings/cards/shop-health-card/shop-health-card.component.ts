import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';
import { DEFAULT_HEALTH_THRESHOLDS } from '../../../../../shared/utils/shop-health.utils';

@Component({
  selector: 'app-shop-health-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './shop-health-card.component.html',
})
export class ShopHealthCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingShopHealth = signal(false);
  isSaving = signal(false);

  shHealthEnabled = signal(true);
  shCustomerWatch = signal(DEFAULT_HEALTH_THRESHOLDS.customerWatchDays);
  shCustomerAtRisk = signal(DEFAULT_HEALTH_THRESHOLDS.customerAtRiskDays);
  shProspectCooling = signal(DEFAULT_HEALTH_THRESHOLDS.prospectCoolingDays);
  shProspectCold = signal(DEFAULT_HEALTH_THRESHOLDS.prospectColdDays);

  constructor() {
    effect(() => {
      const r = this.settings.reconciliation();
      const sh = (r as any).shopHealth || {};
      this.shHealthEnabled.set(sh.enabled !== false);
      this.shCustomerWatch.set(sh.customerWatchDays ?? DEFAULT_HEALTH_THRESHOLDS.customerWatchDays);
      this.shCustomerAtRisk.set(sh.customerAtRiskDays ?? DEFAULT_HEALTH_THRESHOLDS.customerAtRiskDays);
      this.shProspectCooling.set(sh.prospectCoolingDays ?? DEFAULT_HEALTH_THRESHOLDS.prospectCoolingDays);
      this.shProspectCold.set(sh.prospectColdDays ?? DEFAULT_HEALTH_THRESHOLDS.prospectColdDays);
    }, { allowSignalWrites: true });
  }

  async saveShopHealth() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/reconciliation', {
        shopHealth: {
          enabled: this.shHealthEnabled(),
          customerWatchDays: this.shCustomerWatch(),
          customerAtRiskDays: this.shCustomerAtRisk(),
          prospectCoolingDays: this.shProspectCooling(),
          prospectColdDays: this.shProspectCold(),
        },
      });
      this.toast.success('Shop health thresholds saved');
      this.editingShopHealth.set(false);
    } catch (e) { console.error(e); this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelShopHealth() {
    const sh = (this.settings.reconciliation() as any).shopHealth || {};
    this.shHealthEnabled.set(sh.enabled !== false);
    this.shCustomerWatch.set(sh.customerWatchDays ?? DEFAULT_HEALTH_THRESHOLDS.customerWatchDays);
    this.shCustomerAtRisk.set(sh.customerAtRiskDays ?? DEFAULT_HEALTH_THRESHOLDS.customerAtRiskDays);
    this.shProspectCooling.set(sh.prospectCoolingDays ?? DEFAULT_HEALTH_THRESHOLDS.prospectCoolingDays);
    this.shProspectCold.set(sh.prospectColdDays ?? DEFAULT_HEALTH_THRESHOLDS.prospectColdDays);
    this.editingShopHealth.set(false);
  }
}
