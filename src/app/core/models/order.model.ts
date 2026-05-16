import { ActionBy } from './action-by.model';

export type OrderStatus = 
  | 'confirmed' 
  | 'out_for_delivery' 
  | 'delivered' 
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod = 
  | 'cash' | 'e_transfer' | 'cheque' | 'other';
export type DeliveryType = 'delivery' | 'pickup';
export type OrderSource = 'admin_created' | 'customer_portal';

export interface OrderItem {
  productId: string;
  productName: string;       // snapshot
  productSku: string;        // snapshot
  quantity: number;
  unitPriceCents: number;    // snapshot at order time
  unitCostCents: number;     // snapshot for margin calc
  lineTotalCents: number;    // unitPrice × quantity
  lineCostCents: number;     // unitCost × quantity
  currencyCode: string;
}

export interface Order {
  id: string;
  orderNumber: string;       // TRX-2026-0001
  customerId: string;
  customerName: string;      // snapshot
  customerPhone: string;     // snapshot
  serviceAreaId?: string;    // snapshot from customer
  serviceAreaName?: string;  // snapshot from customer

  items: OrderItem[];

  subtotalCents: number;
  taxRatePercent: number;    // e.g. 13 for 13% HST
  taxCents: number;
  discountCents: number;     // manual discount
  totalCents: number;        // subtotal - discount + tax
  currencyCode: string;

  // Margin (sum of lineCostCents vs lineTotalCents)
  totalCostCents: number;    // sum of lineCostCents
  marginCents: number;       // totalCents - totalCostCents

  status: OrderStatus;
  paymentStatus: PaymentStatus;
  amountPaidCents: number;
  balanceCents: number;      // totalCents - amountPaidCents

  source: OrderSource;
  deliveryType: DeliveryType;

  customerNotes: string;     // from customer
  internalNotes: string;     // staff only

  expectedDeliveryDate?: any;
  confirmedAt: any;
  confirmedBy: ActionBy;
  outForDeliveryAt?: any;
  outForDeliveryBy?: ActionBy;
  deliveredAt?: any;
  deliveredBy?: ActionBy;
  cancelledAt?: any;
  cancelledBy?: ActionBy;
  cancellationReason?: string;
  lastPaymentAt?: any;

  tenantId: number;
  createdAt: any;
  createdBy: ActionBy;
  isDeleted: boolean;
  isDeletedAt?: any;
  deletedBy?: ActionBy;
}

// Order number sequence stored in:
// settings/orderSequence → { lastNumber: number, prefix: 'TRX' }

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  confirmed: 'Confirmed',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  confirmed: 'info',
  out_for_delivery: 'warning',
  delivered: 'success',
  cancelled: 'danger'
};
