import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-payment-methods-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './payment-methods-card.component.html',
})
export class PaymentMethodsCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingPaymentMethods = signal(false);
  isSaving = signal(false);

  paymentCashOnDelivery = signal(true);
  paymentETransfer = signal(true);
  paymentCheque = signal(false);

  constructor() {
    effect(() => {
      const ord = this.settings.ordering();
      this.paymentCashOnDelivery.set(
        ord.paymentMethodsShown?.cashOnDelivery ?? true
      );
      this.paymentETransfer.set(
        ord.paymentMethodsShown?.eTransfer ?? true
      );
      this.paymentCheque.set(
        ord.paymentMethodsShown?.cheque ?? false
      );
    }, { allowSignalWrites: true });
  }

  cancelPaymentMethods() {
    const ord = this.settings.ordering();
    this.paymentCashOnDelivery.set(
      ord.paymentMethodsShown?.cashOnDelivery ?? true);
    this.paymentETransfer.set(
      ord.paymentMethodsShown?.eTransfer ?? true);
    this.paymentCheque.set(
      ord.paymentMethodsShown?.cheque ?? false);
    this.editingPaymentMethods.set(false);
  }

  async savePaymentMethods() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        paymentMethodsShown: {
          cashOnDelivery:
            this.paymentCashOnDelivery(),
          eTransfer: this.paymentETransfer(),
          cheque: this.paymentCheque(),
        },
      });
      this.toast.success(
        'Payment methods saved');
      this.editingPaymentMethods.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save payment methods');
    } finally {
      this.isSaving.set(false);
    }
  }
}
