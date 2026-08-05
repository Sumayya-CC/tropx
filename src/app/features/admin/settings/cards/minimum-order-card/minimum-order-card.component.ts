import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-minimum-order-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './minimum-order-card.component.html',
})
export class MinimumOrderCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingMinimumOrder = signal(false);
  isSaving = signal(false);

  minimumOrderEnabled = signal(false);
  minimumOrderScope = signal<'cart' | 'per_product'>('cart');
  minimumOrderType = signal<'quantity' | 'amount'>('amount');
  minimumOrderValue = signal(0);

  constructor() {
    effect(() => {
      const ord = this.settings.ordering();
      this.minimumOrderEnabled.set(ord.minimumOrderEnabled ?? false);
      this.minimumOrderScope.set(ord.minimumOrderScope || 'cart');
      this.minimumOrderType.set(ord.minimumOrderType || 'amount');
      this.minimumOrderValue.set(
        ord.minimumOrderType === 'amount'
          ? (ord.minimumOrderValue ?? 0) / 100
          : (ord.minimumOrderValue ?? 0)
      );
    }, { allowSignalWrites: true });
  }

  cancelMinimumOrder() {
    const ord = this.settings.ordering();
    this.minimumOrderEnabled.set(
      ord.minimumOrderEnabled ?? false);
    this.minimumOrderScope.set(
      ord.minimumOrderScope || 'cart');
    this.minimumOrderType.set(
      ord.minimumOrderType || 'amount');
    this.minimumOrderValue.set(
      ord.minimumOrderType === 'amount'
        ? (ord.minimumOrderValue ?? 0) / 100
        : (ord.minimumOrderValue ?? 0));
    this.editingMinimumOrder.set(false);
  }

  async saveMinimumOrder() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        minimumOrderEnabled:
          this.minimumOrderEnabled(),
        minimumOrderScope:
          this.minimumOrderScope(),
        minimumOrderType:
          this.minimumOrderType(),
        minimumOrderValue:
          this.minimumOrderType() === 'amount'
            ? Math.round(
                this.minimumOrderValue() * 100)
            : this.minimumOrderValue(),
      });
      this.toast.success(
        'Minimum order settings saved');
      this.editingMinimumOrder.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save minimum order settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
