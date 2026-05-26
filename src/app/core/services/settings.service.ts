import { Injectable, inject, computed, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';

export interface BusinessSettings {
  companyName: string;
  tradingName: string;
  logoUrl: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  businessNumber: string;
  hstNumber: string;
  currencyCode: string;
  timezone: string;
}

export interface InvoiceSettings {
  paymentTermsDays: number;
  footerMessage: string;
  etransferEmail: string;
  acceptCash: boolean;
  showHstBreakdown: boolean;
}

export interface OrderingSettings {
  defaultTaxRatePercent: number;
  defaultDeliveryType: 'delivery' | 'pickup';
  orderPrefix: string;
  paymentPrefix: string;
  returnPrefix: string;
  overdueAfterDays: number;  // default 30
}

export interface NotificationSettings {
  // Admin alerts (existing)
  newOrderAlert: boolean;
  accessRequestAlert: boolean;
  returnSubmittedAlert: boolean;
  lowStockAlert: boolean;
  // Customer notifications (new)
  customerOrderConfirmed: boolean;
  customerOutForDelivery: boolean;
  customerOrderDelivered: boolean;
  customerOrderCancelled: boolean;
  customerReturnApproved: boolean;
  customerReturnRejected: boolean;
  customerPaymentReceipt: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  newOrderAlert: true,
  accessRequestAlert: true,
  returnSubmittedAlert: true,
  lowStockAlert: true,
  customerOrderConfirmed: true,
  customerOutForDelivery: true,
  customerOrderDelivered: true,
  customerOrderCancelled: true,
  customerReturnApproved: true,
  customerReturnRejected: true,
  customerPaymentReceipt: true,
};

export const DEFAULT_BUSINESS: BusinessSettings = {
  companyName: 'Tropx Enterprises Inc.',
  tradingName: 'Tropx Wholesale',
  logoUrl: '',
  street: '',
  city: 'Kitchener',
  province: 'ON',
  postalCode: '',
  country: 'Canada',
  phone: '',
  email: 'admin@tropxwholesale.ca',
  website: 'tropxwholesale.ca',
  businessNumber: '793273830',
  hstNumber: '793273830 RT 0001',
  currencyCode: 'CAD',
  timezone: 'America/Toronto',
};

export const DEFAULT_INVOICE: InvoiceSettings = {
  paymentTermsDays: 30,
  footerMessage: 'Thank you for your business!',
  etransferEmail: 'tropxenterprises@gmail.com',
  acceptCash: true,
  showHstBreakdown: true,
 };

export const DEFAULT_ORDERING: OrderingSettings = {
  defaultTaxRatePercent: 13,
  defaultDeliveryType: 'delivery',
  orderPrefix: 'TRX',
  paymentPrefix: 'PAY',
  returnPrefix: 'RET',
  overdueAfterDays: 30,
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly firestore = inject(FirestoreService);
  private readonly storage = inject(Storage);

  private business$ = this.firestore
    .getDocument<BusinessSettings>('settings/business');

  private invoice$ = this.firestore
    .getDocument<InvoiceSettings>('settings/invoice');

  private ordering$ = this.firestore
    .getDocument<OrderingSettings>('settings/ordering');

  private _business = toSignal(this.business$);
  private _invoice = toSignal(this.invoice$);
  private _ordering = toSignal(this.ordering$);
  private _notificationsData = signal<NotificationSettings | null>(null);

  constructor() {
    this.firestore.getDocument<NotificationSettings>(
      'settings/notifications'
    ).subscribe(data => this._notificationsData.set(data));
  }

  business = computed(() => ({
    ...DEFAULT_BUSINESS,
    ...this._business()
  }));

  invoice = computed(() => ({
    ...DEFAULT_INVOICE,
    ...this._invoice()
  }));

  ordering = computed(() => ({
    ...DEFAULT_ORDERING,
    ...this._ordering()
  }));

  notifications = computed(() => ({
    ...DEFAULT_NOTIFICATIONS,
    ...(this._notificationsData() ?? {})
  }));

  async uploadLogo(file: File): Promise<string> {
    const ext = file.name.split('.').pop();
    const storageRef = ref(
      this.storage, `settings/logo.${ext}`
    );
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }
}
