import { ActionBy } from './action-by.model';

export type OrderStatus = 'pending' | 'delivered' | 'paid' | 'voided';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod = 'cash' | 'e_transfer' | 'cheque' | 'other';

export interface OrderItem {
  productId: string;
  // Name and SKU snapshotted so order history is immune to future product edits
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  currencyCode: string;
}

export interface Payment {
  id: string;
  paymentNumber: string;
  amountCents: number;
  currencyCode: string;
  method: PaymentMethod;
  paymentDate: Date;
  notes?: string;
  recordedBy: ActionBy;
  recordedAt: Date;
  // Payments are append-only; voiding (soft delete) preserves the audit trail
  isDeleted: boolean;
  isDeletedAt?: Date;
  deletedBy?: ActionBy;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  // Denormalized name avoids expensive joins in order list views
  customerName: string;
  items: OrderItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currencyCode: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  amountPaidCents: number;
  balanceCents: number;
  createdAt: Date;
  createdBy: ActionBy;
  deliveredAt?: Date;
  paidAt?: Date;
  voidedAt?: Date;
  voidedBy?: ActionBy;
  invoiceUrl?: string;
  notes?: string;
  tenantId: number;
  isDeleted: boolean;
  isDeletedAt?: Date;
  deletedBy?: ActionBy;
}
