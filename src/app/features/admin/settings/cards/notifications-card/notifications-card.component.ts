import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-notifications-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications-card.component.html',
  styleUrl: './notifications-card.component.scss',
})
export class NotificationsCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingNotifications = signal(false);
  isSaving = signal(false);

  newOrderAlert = signal(true);
  accessRequestAlert = signal(true);
  returnSubmittedAlert = signal(true);
  lowStockAlert = signal(true);

  customerOrderConfirmed = signal(true);
  customerOutForDelivery = signal(true);
  customerOrderDelivered = signal(true);
  customerOrderCancelled = signal(true);
  customerReturnApproved = signal(true);
  customerReturnRejected = signal(true);
  customerPaymentReceipt = signal(true);

  constructor() {
    effect(() => {
      const n = this.settings.notifications();
      this.newOrderAlert.set(n.newOrderAlert);
      this.accessRequestAlert.set(n.accessRequestAlert);
      this.returnSubmittedAlert.set(n.returnSubmittedAlert);
      this.lowStockAlert.set(n.lowStockAlert);
      this.customerOrderConfirmed.set(n.customerOrderConfirmed);
      this.customerOutForDelivery.set(n.customerOutForDelivery);
      this.customerOrderDelivered.set(n.customerOrderDelivered);
      this.customerOrderCancelled.set(n.customerOrderCancelled);
      this.customerReturnApproved.set(n.customerReturnApproved);
      this.customerReturnRejected.set(n.customerReturnRejected);
      this.customerPaymentReceipt.set(n.customerPaymentReceipt);
    }, { allowSignalWrites: true });
  }

  cancelNotifications() {
    const n = this.settings.notifications();
    this.newOrderAlert.set(n.newOrderAlert);
    this.accessRequestAlert.set(n.accessRequestAlert);
    this.returnSubmittedAlert.set(n.returnSubmittedAlert);
    this.lowStockAlert.set(n.lowStockAlert);
    this.customerOrderConfirmed.set(n.customerOrderConfirmed);
    this.customerOutForDelivery.set(n.customerOutForDelivery);
    this.customerOrderDelivered.set(n.customerOrderDelivered);
    this.customerOrderCancelled.set(n.customerOrderCancelled);
    this.customerReturnApproved.set(n.customerReturnApproved);
    this.customerReturnRejected.set(n.customerReturnRejected);
    this.customerPaymentReceipt.set(n.customerPaymentReceipt);
    this.editingNotifications.set(false);
  }

  // Instant-save, bypasses the edit/save/cancel flow below — a known,
  // pre-existing UX inconsistency (not introduced by this split, and
  // explicitly out of scope to change here).
  async updateNotification(key: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    try {
      await this.firestore.updateDocument('settings/notifications', {
        [key]: checked
      });
      this.toast.success('Notification setting updated');
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to update notification setting');
    }
  }

  async saveNotifications() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/notifications', {
        newOrderAlert: this.newOrderAlert(),
        accessRequestAlert: this.accessRequestAlert(),
        returnSubmittedAlert: this.returnSubmittedAlert(),
        lowStockAlert: this.lowStockAlert(),
        customerOrderConfirmed: this.customerOrderConfirmed(),
        customerOutForDelivery: this.customerOutForDelivery(),
        customerOrderDelivered: this.customerOrderDelivered(),
        customerOrderCancelled: this.customerOrderCancelled(),
        customerReturnApproved: this.customerReturnApproved(),
        customerReturnRejected: this.customerReturnRejected(),
        customerPaymentReceipt: this.customerPaymentReceipt(),
        abandonedCart24h: this.settings.notifications().abandonedCart24h,
        abandonedCart72h: this.settings.notifications().abandonedCart72h,
        abandonedCart7d: this.settings.notifications().abandonedCart7d,
      });
      this.toast.success('Notification settings saved');
      this.editingNotifications.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save notification settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
