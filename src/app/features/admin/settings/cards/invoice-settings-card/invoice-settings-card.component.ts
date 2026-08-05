import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-invoice-settings-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './invoice-settings-card.component.html',
})
export class InvoiceSettingsCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingInvoice = signal(false);
  isSaving = signal(false);

  paymentTermsDays = signal(30);
  footerMessage = signal('Thank you for your business!');
  etransferEmail = signal('');
  acceptCash = signal(true);
  showHstBreakdown = signal(true);
  portalInvoiceDownloadEnabled = signal(true);
  portalInvoiceDownloadNote = signal(
    'Invoice will be sent by email once your order is delivered.'
  );

  constructor() {
    effect(() => {
      const inv = this.settings.invoice();
      this.paymentTermsDays.set(inv.paymentTermsDays);
      this.footerMessage.set(inv.footerMessage || '');
      this.etransferEmail.set(inv.etransferEmail || '');
      this.acceptCash.set(inv.acceptCash);
      this.showHstBreakdown.set(inv.showHstBreakdown);
      this.portalInvoiceDownloadEnabled.set(
        inv.portalInvoiceDownloadEnabled ?? true
      );
      this.portalInvoiceDownloadNote.set(
        inv.portalInvoiceDownloadNote ||
        'Invoice will be sent by email once your order is delivered.'
      );
    }, { allowSignalWrites: true });
  }

  cancelInvoice() {
    const inv = this.settings.invoice();
    this.paymentTermsDays.set(inv.paymentTermsDays);
    this.footerMessage.set(inv.footerMessage || '');
    this.etransferEmail.set(inv.etransferEmail || '');
    this.acceptCash.set(inv.acceptCash);
    this.showHstBreakdown.set(inv.showHstBreakdown);
    this.portalInvoiceDownloadEnabled.set(
      inv.portalInvoiceDownloadEnabled ?? true
    );
    this.portalInvoiceDownloadNote.set(
      inv.portalInvoiceDownloadNote ||
      'Invoice will be sent by email once your order is delivered.'
    );
    this.editingInvoice.set(false);
  }

  async saveInvoice() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/invoice', {
        paymentTermsDays: this.paymentTermsDays(),
        footerMessage: this.footerMessage(),
        etransferEmail: this.etransferEmail(),
        acceptCash: this.acceptCash(),
        showHstBreakdown: this.showHstBreakdown(),
        portalInvoiceDownloadEnabled: this.portalInvoiceDownloadEnabled(),
        portalInvoiceDownloadNote: this.portalInvoiceDownloadNote(),
      });
      this.toast.success('Invoice settings saved');
      this.editingInvoice.set(false);
    } catch (err) {
      this.toast.error('Failed to save invoice settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
