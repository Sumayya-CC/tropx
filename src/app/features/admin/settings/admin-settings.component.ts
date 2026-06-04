import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SettingsService } from '../../../core/services/settings.service';
import { Storage } from '@angular/fire/storage';

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly storage = inject(Storage);

  editingBusiness = signal(false);
  editingInvoice = signal(false);
  editingOrdering = signal(false);
  editingNotifications = signal(false);
  isSaving = signal(false);

  // Business form fields
  companyName = signal('');
  tradingName = signal('');
  logoUrl = signal('');
  logoFile = signal<File | null>(null);
  logoPreview = signal('');
  street = signal('');
  city = signal('');
  province = signal('ON');
  postalCode = signal('');
  country = signal('Canada');
  phone = signal('');
  email = signal('');
  website = signal('');
  businessNumber = signal('');
  hstNumber = signal('');
  currencyCode = signal('CAD');
  timezone = signal('America/Toronto');

  // Invoice form fields
  paymentTermsDays = signal(30);
  footerMessage = signal('Thank you for your business!');
  etransferEmail = signal('');
  acceptCash = signal(true);
  showHstBreakdown = signal(true);

  // Ordering form fields
  defaultTaxRatePercent = signal(13);
  defaultDeliveryType = signal<'delivery' | 'pickup'>('delivery');
  orderPrefix = signal('TRX');
  paymentPrefix = signal('PAY');
  returnPrefix = signal('RET');
  overdueAfterDays = signal(30);

  // Notification settings form fields
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

  // Prefix warning: show if user changes prefix
  orderPrefixChanged = signal(false);
  paymentPrefixChanged = signal(false);
  returnPrefixChanged = signal(false);

  constructor() {
    effect(() => {
      const b = this.settings.business();
      this.companyName.set(b.companyName);
      this.tradingName.set(b.tradingName);
      this.logoUrl.set(b.logoUrl || '');
      this.logoPreview.set(b.logoUrl || '');
      this.street.set(b.street || '');
      this.city.set(b.city || '');
      this.province.set(b.province || 'ON');
      this.postalCode.set(b.postalCode || '');
      this.country.set(b.country || 'Canada');
      this.phone.set(b.phone || '');
      this.email.set(b.email || '');
      this.website.set(b.website || '');
      this.businessNumber.set(b.businessNumber || '');
      this.hstNumber.set(b.hstNumber || '');
      this.currencyCode.set(b.currencyCode || 'CAD');
      this.timezone.set(b.timezone || 'America/Toronto');
    }, { allowSignalWrites: true });

    effect(() => {
      const inv = this.settings.invoice();
      this.paymentTermsDays.set(inv.paymentTermsDays);
      this.footerMessage.set(inv.footerMessage || '');
      this.etransferEmail.set(inv.etransferEmail || '');
      this.acceptCash.set(inv.acceptCash);
      this.showHstBreakdown.set(inv.showHstBreakdown);
    }, { allowSignalWrites: true });

    effect(() => {
      const ord = this.settings.ordering();
      this.defaultTaxRatePercent.set(ord.defaultTaxRatePercent);
      this.defaultDeliveryType.set(ord.defaultDeliveryType || 'delivery');
      this.orderPrefix.set(ord.orderPrefix || 'TRX');
      this.paymentPrefix.set(ord.paymentPrefix || 'PAY');
      this.returnPrefix.set(ord.returnPrefix || 'RET');
      this.overdueAfterDays.set(ord.overdueAfterDays || 30);
    }, { allowSignalWrites: true });

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

  cancelBusiness() {
    const b = this.settings.business();
    this.companyName.set(b.companyName);
    this.tradingName.set(b.tradingName);
    this.logoUrl.set(b.logoUrl || '');
    this.logoPreview.set(b.logoUrl || '');
    this.logoFile.set(null);
    this.street.set(b.street || '');
    this.city.set(b.city || '');
    this.province.set(b.province || 'ON');
    this.postalCode.set(b.postalCode || '');
    this.country.set(b.country || 'Canada');
    this.phone.set(b.phone || '');
    this.email.set(b.email || '');
    this.website.set(b.website || '');
    this.businessNumber.set(b.businessNumber || '');
    this.hstNumber.set(b.hstNumber || '');
    this.currencyCode.set(b.currencyCode || 'CAD');
    this.timezone.set(b.timezone || 'America/Toronto');
    this.editingBusiness.set(false);
  }

  cancelInvoice() {
    const inv = this.settings.invoice();
    this.paymentTermsDays.set(inv.paymentTermsDays);
    this.footerMessage.set(inv.footerMessage || '');
    this.etransferEmail.set(inv.etransferEmail || '');
    this.acceptCash.set(inv.acceptCash);
    this.showHstBreakdown.set(inv.showHstBreakdown);
    this.editingInvoice.set(false);
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

  async saveBusiness() {
    this.isSaving.set(true);
    try {
      let finalLogoUrl = this.logoUrl();

      if (this.logoFile()) {
        finalLogoUrl = await this.settings.uploadLogo(this.logoFile()!);
        this.logoUrl.set(finalLogoUrl);
        this.logoFile.set(null);
      }

      await this.firestore.setDocument('settings/business', {
        companyName: this.companyName(),
        tradingName: this.tradingName(),
        logoUrl: finalLogoUrl,
        street: this.street(),
        city: this.city(),
        province: this.province(),
        postalCode: this.postalCode(),
        country: this.country(),
        phone: this.phone(),
        email: this.email(),
        website: this.website(),
        businessNumber: this.businessNumber(),
        hstNumber: this.hstNumber(),
        currencyCode: this.currencyCode(),
        timezone: this.timezone(),
      });
      this.toast.success('Business settings saved');
      this.editingBusiness.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save business settings');
    } finally {
      this.isSaving.set(false);
    }
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
      });
      this.toast.success('Invoice settings saved');
      this.editingInvoice.set(false);
    } catch (err) {
      this.toast.error('Failed to save invoice settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveOrdering() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/ordering', {
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

  onLogoSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      this.toast.error('Logo must be under 2MB');
      return;
    }
    this.logoFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => this.logoPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  removeLogo() {
    this.logoFile.set(null);
    this.logoPreview.set('');
    this.logoUrl.set('');
  }

  exporting = signal<string | null>(null);

  async exportToCsv(type: 'orders' | 'payments' | 'customers') {
    this.exporting.set(type);
    try {
      const { firstValueFrom } = await import('rxjs');
      let data: any[] = [];
      
      if (type === 'orders') {
        const obs = this.firestore.getCollection<any>('orders');
        const all = await firstValueFrom(obs);
        data = all.filter(item => !item.isDeleted);
        
        const headers = [
          'Order ID', 'Order Number', 'Customer Name', 'Customer Email',
          'Delivery Type', 'Service Area', 'Status', 'Subtotal', 'Discount',
          'HST', 'Total', 'Balance', 'Confirmed At', 'Created At'
        ];
        
        const rows = data.map(o => [
          o.id,
          o.orderNumber,
          o.customerName,
          o.customerEmail,
          o.deliveryType,
          o.serviceAreaName,
          o.status,
          this.formatCurrency(o.subtotalCents),
          this.formatCurrency(o.discountCents),
          this.formatCurrency(o.taxCents),
          this.formatCurrency(o.totalCents),
          this.formatCurrency(o.balanceCents),
          this.formatDate(o.confirmedAt),
          this.formatDate(o.createdAt)
        ]);
        
        const csvContent = this.generateCsvContent(headers, rows);
        this.downloadCsv(`orders_export_${Date.now()}.csv`, csvContent);
        
      } else if (type === 'payments') {
        const obs = this.firestore.getCollection<any>('payments');
        const all = await firstValueFrom(obs);
        data = all.filter(item => !item.isDeleted);
        
        const headers = [
          'Payment ID', 'Payment Number', 'Order Number', 'Customer Name',
          'Amount', 'Method', 'Reference', 'Received Date', 'Created At'
        ];
        
        const rows = data.map(p => [
          p.id,
          p.paymentNumber,
          p.orderNumber,
          p.customerName,
          this.formatCurrency(p.amountCents),
          p.method,
          p.referenceNumber,
          p.receivedDate,
          this.formatDate(p.createdAt)
        ]);
        
        const csvContent = this.generateCsvContent(headers, rows);
        this.downloadCsv(`payments_export_${Date.now()}.csv`, csvContent);
        
      } else if (type === 'customers') {
        const obs = this.firestore.getCollection<any>('customers');
        const all = await firstValueFrom(obs);
        data = all.filter(item => !item.isDeleted);
        
        const headers = [
          'Customer ID', 'Business Name', 'Owner Name', 'Email', 'Phone',
          'Business Type', 'Service Area', 'Status', 'Total Ordered',
          'Total Owing', 'Created At'
        ];
        
        const rows = data.map(c => [
          c.id,
          c.businessName,
          c.ownerName,
          c.email,
          c.phone,
          c.businessType,
          c.serviceAreaName || c.serviceAreaCustom || '',
          c.status,
          this.formatCurrency(c.totalOrderedCents),
          this.formatCurrency(c.totalOwingCents),
          this.formatDate(c.createdAt)
        ]);
        
        const csvContent = this.generateCsvContent(headers, rows);
        this.downloadCsv(`customers_export_${Date.now()}.csv`, csvContent);
      }
      
      this.toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} exported successfully`);
    } catch (err) {
      console.error(err);
      this.toast.error(`Failed to export ${type}`);
    } finally {
      this.exporting.set(null);
    }
  }

  private generateCsvContent(headers: string[], rows: any[][]): string {
    const csvRows = [
      headers.map(h => this.escapeCsv(h)).join(','),
      ...rows.map(row => row.map(cell => this.escapeCsv(cell)).join(','))
    ];
    return csvRows.join('\r\n');
  }

  private escapeCsv(val: any): string {
    if (val === null || val === undefined) return '';
    let str = String(val);
    str = str.replace(/"/g, '""');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str}"`;
    }
    return str;
  }

  private formatCurrency(cents: number | undefined | null): string {
    if (cents === undefined || cents === null) return '$0.00';
    return '$' + (cents / 100).toFixed(2);
  }

  private formatDate(ts: any): string {
    if (!ts) return '';
    let date: Date;
    if (ts.toDate) {
      date = ts.toDate();
    } else if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else {
      date = new Date(ts);
    }
    if (isNaN(date.getTime())) return '';
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }

  private downloadCsv(filename: string, csvContent: string) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
}
