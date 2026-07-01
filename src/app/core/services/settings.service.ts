import { Injectable, inject, computed, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { map } from 'rxjs';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { Firestore, doc } from '@angular/fire/firestore';
import { StorefrontSettings, DEFAULT_STOREFRONT_SETTINGS } from '../models/storefront-settings.model';

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
  socialMedia?: {
    facebook?: string;
    instagram?: string;
    whatsapp?: string;
    youtube?: string;
    tiktok?: string;
  };
}

export interface InvoiceSettings {
  paymentTermsDays: number;
  footerMessage: string;
  etransferEmail: string;
  acceptCash: boolean;
  showHstBreakdown: boolean;
  portalInvoiceDownloadEnabled?: boolean;
  portalInvoiceDownloadNote?: string;
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
  outOfStockBehavior?: 'hide' | 'show_disabled' | 'allow_backorder';
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

export interface InventorySettings {
  defaultWarehouseId: string;
  defaultWarehouseName: string;
  multiWarehouseEnabled: boolean;
}

export const DEFAULT_INVENTORY: InventorySettings = {
  defaultWarehouseId: '',
  defaultWarehouseName: 'Main Warehouse',
  multiWarehouseEnabled: false,
};

export interface ReconciliationSettings {
  notifyThresholdCents: number;
  autoCorrectMaxCents: number;
  autoCorrectEnabled: boolean;
  notifyAdmin: boolean;
  tenantId: number;
}

export const DEFAULT_RECONCILIATION: ReconciliationSettings = {
  notifyThresholdCents: 100,
  autoCorrectMaxCents: 5000,
  autoCorrectEnabled: true,
  notifyAdmin: true,
  tenantId: 1,
};

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
  socialMedia: {
    facebook: '',
    instagram: '',
    whatsapp: '',
    youtube: '',
    tiktok: '',
  },
};

export const DEFAULT_INVOICE: InvoiceSettings = {
  paymentTermsDays: 30,
  footerMessage: 'Thank you for your business!',
  etransferEmail: 'tropxenterprises@gmail.com',
  acceptCash: true,
  showHstBreakdown: true,
  portalInvoiceDownloadEnabled: true,
  portalInvoiceDownloadNote: 'Invoice will be '
    + 'sent by email once your order is '
    + 'delivered.',
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

  outOfStockBehavior: 'show_disabled',
  showBackorderMessage: true,
  backorderMessage: 'This item is currently '
    + 'low in stock. We may need additional '
    + 'time to fulfill part of your order.',

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
  private readonly firestoreDb = inject(Firestore);
  private readonly storage = inject(Storage);

  private _business = signal<BusinessSettings | null>(null);
  private _invoice = signal<InvoiceSettings | null>(null);
  private _ordering = signal<OrderingSettings | null>(null);
  private _storefront = signal<StorefrontSettings | null>(null);
  private _notificationsData = signal<NotificationSettings | null>(null);
  private _inventory = signal<InventorySettings | null>(null);
  private _reconciliation = signal<ReconciliationSettings | null>(null);

  constructor() {
    this.firestore.getDocument<BusinessSettings>('settings/business')
      .subscribe(v => this._business.set(v));
    this.firestore.getDocument<InvoiceSettings>('settings/invoice')
      .subscribe(v => this._invoice.set(v));
    this.firestore.getDocument<OrderingSettings>('settings/ordering')
      .subscribe(v => this._ordering.set(v));
    this.firestore.getDocument<StorefrontSettings>('settings/storefront')
      .subscribe(v => this._storefront.set(v));
    this.firestore.getDocument<NotificationSettings>('settings/notifications')
      .subscribe(v => this._notificationsData.set(v));
    this.firestore.getDocument<InventorySettings>('settings/inventory')
      .subscribe(v => this._inventory.set(v));
    this.firestore.getDocument<ReconciliationSettings>('settings/reconciliation')
      .subscribe(v => this._reconciliation.set(v));
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

  storefront = computed(() => ({
    ...DEFAULT_STOREFRONT_SETTINGS,
    ...this._storefront()
  }));

  notifications = computed(() => ({
    ...DEFAULT_NOTIFICATIONS,
    ...(this._notificationsData() ?? {})
  }));

  inventory = computed(() => ({
    ...DEFAULT_INVENTORY,
    ...(this._inventory() ?? {})
  }));

  reconciliation = computed(() => ({
    ...DEFAULT_RECONCILIATION,
    ...(this._reconciliation() ?? {})
  }));



  async uploadLogo(file: File): Promise<string> {
    const ext = file.name.split('.').pop();
    const storageRef = ref(
      this.storage, `settings/logo.${ext}`
    );
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }

  async getNextPoNumber(): Promise<string> {
    const { runTransaction } = await import('@angular/fire/firestore');
    return runTransaction(this.firestoreDb, async (tx) => {
      const ref = doc(this.firestoreDb, 'settings/poSequence');
      const snap = await tx.get(ref);
      const data = (snap.exists() ? snap.data() : { prefix: 'PO', nextNumber: 1, padding: 5 }) as any;
      const nextNum = data['nextNumber'] || 1;
      const prefix = data['prefix'] || 'PO';
      const padding = data['padding'] || 5;
      
      tx.set(ref, { ...data, nextNumber: nextNum + 1 });
      
      return `${prefix}-${String(nextNum).padStart(padding, '0')}`;
    });
  }

  async getNextReceiveNumber(): Promise<string> {
    const { runTransaction } = await import('@angular/fire/firestore');
    return runTransaction(this.firestoreDb, async (tx) => {
      const ref = doc(this.firestoreDb, 'settings/receiveSequence');
      const snap = await tx.get(ref);
      const data = (snap.exists() ? snap.data() : { prefix: 'GRN', nextNumber: 1, padding: 5 }) as any;
      const nextNum = data['nextNumber'] || 1;
      const prefix = data['prefix'] || 'GRN';
      const padding = data['padding'] || 5;
      
      tx.set(ref, { ...data, nextNumber: nextNum + 1 });
      
      return `${prefix}-${String(nextNum).padStart(padding, '0')}`;
    });
  }
}

