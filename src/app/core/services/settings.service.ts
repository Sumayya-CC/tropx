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
  defaultTaxRate: number;

  deliveryOptions?: 'delivery_only' | 'pickup_only' | 'both';
  pickupAddressMode?: 'same_as_business' | 'custom';
  pickupCustomAddress?: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
  } | null;
  deliveryEstimateDays?: number;
  deliveryEstimateText?: string;
  paymentMethodsShown?: {
    cashOnDelivery: boolean;
    eTransfer: boolean;
    cheque: boolean;
  };
  lowStockVisibility?: 'none' | 'vague' | 'exact';
  lowStockCustomerThreshold?: number;
  allowBackorder?: boolean;
  showBackorderMessage?: boolean;
  backorderMessage?: string;
  minimumOrderEnabled?: boolean;
  minimumOrderScope?: 'cart' | 'per_product';
  minimumOrderType?: 'quantity' | 'amount';
  minimumOrderValue?: number;
  closureActive?: boolean;
  closureMessage?: string | null;
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
  // Abandoned cart notifications
  abandonedCart24h: boolean;
  abandonedCart72h: boolean;
  abandonedCart7d: boolean;
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
  abandonedCart24h: true,
  abandonedCart72h: true,
  abandonedCart7d: false,
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
  defaultTaxRate: 13,

  deliveryOptions: 'both',
  pickupAddressMode: 'same_as_business',
  pickupCustomAddress: undefined,

  paymentMethodsShown: {
    cashOnDelivery: true,
    eTransfer: true,
    cheque: false,
  },

  lowStockVisibility: 'vague',
  lowStockCustomerThreshold: 5,

  allowBackorder: false,
  showBackorderMessage: true,
  backorderMessage: 'This item is currently low '
    + 'in stock. We may need additional time to '
    + 'fulfill part of your order.',

  deliveryEstimateDays: 2,
  deliveryEstimateText: 'Delivered within '
    + '{days} business days',

  minimumOrderEnabled: false,
  minimumOrderScope: 'cart',
  minimumOrderType: 'amount',
  minimumOrderValue: 0,

  closureActive: false,
  closureMessage: '',
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
