import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-delivery-options-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './delivery-options-card.component.html',
  styleUrl: './delivery-options-card.component.scss',
})
export class DeliveryOptionsCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingDelivery = signal(false);
  isSaving = signal(false);

  deliveryOptions = signal<'delivery_only' | 'pickup_only' | 'both'>('both');
  pickupAddressMode = signal<'same_as_business' | 'custom'>('same_as_business');
  pickupStreet = signal('');
  pickupCity = signal('');
  pickupProvince = signal('');
  pickupPostalCode = signal('');
  deliveryEstimateDays = signal(2);
  deliveryEstimateText = signal('Delivered within {days} business days');

  constructor() {
    effect(() => {
      const ord = this.settings.ordering();
      this.deliveryOptions.set(ord.deliveryOptions || 'both');
      this.pickupAddressMode.set(ord.pickupAddressMode || 'same_as_business');
      this.pickupStreet.set(ord.pickupCustomAddress?.street || '');
      this.pickupCity.set(ord.pickupCustomAddress?.city || '');
      this.pickupProvince.set(ord.pickupCustomAddress?.province || '');
      this.pickupPostalCode.set(ord.pickupCustomAddress?.postalCode || '');
      this.deliveryEstimateDays.set(ord.deliveryEstimateDays ?? 2);
      this.deliveryEstimateText.set(
        ord.deliveryEstimateText ||
        'Delivered within {days} business days'
      );
    }, { allowSignalWrites: true });
  }

  cancelDelivery() {
    const ord = this.settings.ordering();
    this.deliveryOptions.set(
      ord.deliveryOptions || 'both');
    this.pickupAddressMode.set(
      ord.pickupAddressMode || 'same_as_business');
    this.pickupStreet.set(
      ord.pickupCustomAddress?.street || '');
    this.pickupCity.set(
      ord.pickupCustomAddress?.city || '');
    this.pickupProvince.set(
      ord.pickupCustomAddress?.province || '');
    this.pickupPostalCode.set(
      ord.pickupCustomAddress?.postalCode || '');
    this.deliveryEstimateDays.set(
      ord.deliveryEstimateDays ?? 2);
    this.deliveryEstimateText.set(
      ord.deliveryEstimateText ||
      'Delivered within {days} business days');
    this.editingDelivery.set(false);
  }

  async saveDelivery() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        deliveryOptions: this.deliveryOptions(),
        pickupAddressMode: this.pickupAddressMode(),
        pickupCustomAddress:
          this.pickupAddressMode() === 'custom'
            ? {
                street: this.pickupStreet(),
                city: this.pickupCity(),
                province: this.pickupProvince(),
                postalCode: this.pickupPostalCode(),
              }
            : null,
        deliveryEstimateDays:
          this.deliveryEstimateDays(),
        deliveryEstimateText:
          this.deliveryEstimateText(),
      });
      this.toast.success('Delivery settings saved');
      this.editingDelivery.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save delivery settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
