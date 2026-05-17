import { ActionBy } from './action-by.model';

export type PaymentMethod = 
  | 'cash' 
  | 'e_transfer' 
  | 'cheque' 
  | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  e_transfer: 'E-Transfer',
  cheque: 'Cheque',
  other: 'Other',
};

export interface Payment {
  id: string;
  paymentNumber: string;        // PAY-2026-0001
  orderId: string;              // linked order
  orderNumber: string;          // snapshot
  customerId: string;           // linked customer
  customerName: string;         // snapshot
  amountCents: number;          // amount of this payment
  currencyCode: string;         // CAD
  method: PaymentMethod;
  referenceNumber?: string;     // e-transfer ref, cheque #
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
