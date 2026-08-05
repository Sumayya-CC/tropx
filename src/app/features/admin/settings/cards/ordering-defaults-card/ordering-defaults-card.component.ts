import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-ordering-defaults-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ordering-defaults-card.component.html',
  styleUrl: './ordering-defaults-card.component.scss',
})
export class OrderingDefaultsCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingOrdering = signal(false);
  isSaving = signal(false);

  defaultTaxRatePercent = signal(13);
  defaultDeliveryType = signal<'delivery' | 'pickup'>('delivery');
  orderPrefix = signal('TRX');
  paymentPrefix = signal('PAY');
  returnPrefix = signal('RET');
  overdueAfterDays = signal(30);

  orderPrefixChanged = signal(false);
  paymentPrefixChanged = signal(false);
  returnPrefixChanged = signal(false);

  constructor() {
    effect(() => {
      const ord = this.settings.ordering();
      this.defaultTaxRatePercent.set(ord.defaultTaxRatePercent);
      this.defaultDeliveryType.set(ord.defaultDeliveryType || 'delivery');
      this.orderPrefix.set(ord.orderPrefix || 'TRX');
      this.paymentPrefix.set(ord.paymentPrefix || 'PAY');
      this.returnPrefix.set(ord.returnPrefix || 'RET');
      this.overdueAfterDays.set(ord.overdueAfterDays || 30);
    }, { allowSignalWrites: true });
  }

  cancelOrdering() {
    const ord = this.settings.ordering();
    this.defaultTaxRatePercent.set(ord.defaultTaxRatePercent);
    this.defaultDeliveryType.set(ord.defaultDeliveryType || 'delivery');
    this.orderPrefix.set(ord.orderPrefix || 'TRX');
    this.paymentPrefix.set(ord.paymentPrefix || 'PAY');
    this.returnPrefix.set(ord.returnPrefix || 'RET');
    this.overdueAfterDays.set(ord.overdueAfterDays || 30);
    this.orderPrefixChanged.set(false);
    this.paymentPrefixChanged.set(false);
    this.returnPrefixChanged.set(false);
    this.editingOrdering.set(false);
  }

  async saveOrdering() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/ordering', {
        defaultTaxRatePercent: this.defaultTaxRatePercent(),
        defaultDeliveryType: this.defaultDeliveryType(),
        orderPrefix: this.orderPrefix(),
        paymentPrefix: this.paymentPrefix(),
        returnPrefix: this.returnPrefix(),
        overdueAfterDays: this.overdueAfterDays(),
      });

      // Update sequence docs if prefix changed
      if (this.orderPrefixChanged()) {
        await this.firestore.updateDocument('settings/orderSequence', {
          prefix: this.orderPrefix(),
        });
        this.orderPrefixChanged.set(false);
      }
      if (this.paymentPrefixChanged()) {
        await this.firestore.updateDocument('settings/paymentSequence', {
          prefix: this.paymentPrefix(),
        });
        this.paymentPrefixChanged.set(false);
      }
      if (this.returnPrefixChanged()) {
        await this.firestore.updateDocument('settings/returnSequence', {
          prefix: this.returnPrefix(),
        });
        this.returnPrefixChanged.set(false);
      }

      this.toast.success('Ordering settings saved');
      this.editingOrdering.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save ordering settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
