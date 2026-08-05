import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-stock-backorder-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stock-backorder-card.component.html',
})
export class StockBackorderCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingStockBackorder = signal(false);
  isSaving = signal(false);

  lowStockVisibility = signal<'none' | 'vague' | 'exact'>('vague');
  lowStockCustomerThreshold = signal(5);
  outOfStockBehavior = signal<'hide' | 'show_disabled' | 'allow_backorder'>('show_disabled');
  showBackorderMessage = signal(true);
  backorderMessage = signal(
    'This item is currently low in stock. ' +
    'We may need additional time to fulfill ' +
    'part of your order.'
  );

  constructor() {
    effect(() => {
      const ord = this.settings.ordering();
      this.lowStockVisibility.set(ord.lowStockVisibility || 'vague');
      this.lowStockCustomerThreshold.set(ord.lowStockCustomerThreshold ?? 5);
      this.outOfStockBehavior.set(ord.outOfStockBehavior || 'show_disabled');
      this.showBackorderMessage.set(ord.showBackorderMessage ?? true);
      this.backorderMessage.set(
        ord.backorderMessage ||
        'This item is currently low in stock. ' +
        'We may need additional time to fulfill ' +
        'part of your order.'
      );
    }, { allowSignalWrites: true });
  }

  cancelStockBackorder() {
    const ord = this.settings.ordering();
    this.lowStockVisibility.set(
      ord.lowStockVisibility || 'vague');
    this.lowStockCustomerThreshold.set(
      ord.lowStockCustomerThreshold ?? 5);
    this.outOfStockBehavior.set(
      ord.outOfStockBehavior || 'show_disabled');
    this.showBackorderMessage.set(
      ord.showBackorderMessage ?? true);
    this.backorderMessage.set(
      ord.backorderMessage ||
      'This item is currently low in stock. ' +
      'We may need additional time to fulfill ' +
      'part of your order.');
    this.editingStockBackorder.set(false);
  }

  async saveStockBackorder() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        lowStockVisibility:
          this.lowStockVisibility(),
        lowStockCustomerThreshold:
          this.lowStockCustomerThreshold(),
        outOfStockBehavior: this.outOfStockBehavior(),
        showBackorderMessage:
          this.showBackorderMessage(),
        backorderMessage: this.backorderMessage(),
      });
      this.toast.success(
        'Stock settings saved');
      this.editingStockBackorder.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save stock settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
