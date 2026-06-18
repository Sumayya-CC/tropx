import { ActionBy } from './action-by.model';

export type PaymentMethod = 
  | 'cash' 
  | 'e_transfer' 
  | 'cheque' 
  | 'card' 
  | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  e_transfer: 'E-Transfer',
  cheque: 'Cheque',
  card: 'Card Payment',
  other: 'Other',
};

export interface Payment {
  id: string;
  paymentNumber: string;        // PAY-2026-0001
  orderId: string;              // linked order
  orderNumber: string;          // snapshot
  customerId: string;           // linked customer
  customerName: string;         // snapshot
  customerEmail?: string;       // snapshot from order
  amountCents: number;          // amount of this payment
  currencyCode: string;         // CAD
  method: PaymentMethod;
  referenceNumber?: string;     // e-transfer ref, cheque #

  // Vendor-neutral external payment processor
  // transaction ID. Stores Stripe PaymentIntent
  // ID (pi_xxx) today, or equivalent transaction
  // ID from any payment processor.
  externalPaymentId?: string;

  // Which payment processor handled this
  // transaction. e.g. 'stripe', 'square',
  // 'paypal'. Used to route refund operations
  // to the correct API.
  externalPaymentProvider?: string;

  // Raw webhook/event payload reference from
  // the payment processor, for audit/debugging.
  externalEventId?: string;

  receivedDate: string;         // YYYY-MM-DD, actual date
  notes?: string;               // internal notes
  recordedBy: ActionBy;         // who entered it
  recordedAt: any;              // serverTimestamp
  
  // Soft delete = void
  isDeleted: boolean;
  isDeletedAt?: any;
  deletedBy?: ActionBy;
  voidReason?: string;
  tenantId: number;
}
