import { ActionBy } from './action-by.model';

export type BillPaymentMethod = 'cash' | 'e_transfer' | 'cheque' | 'card' | 'other';

export const BILL_PAYMENT_METHOD_LABELS: Record<BillPaymentMethod, string> = {
  cash: 'Cash',
  e_transfer: 'E-Transfer',
  cheque: 'Cheque',
  card: 'Card Payment',
  other: 'Other',
};

export interface BillPayment {
  id: string;
  billId: string;
  billNumber: string;      // snapshot
  supplierId: string;
  supplierName?: string;   // snapshot

  amountCents: number;
  method: BillPaymentMethod;
  referenceNumber?: string;

  paidDate: string;        // YYYY-MM-DD, actual date paid
  notes?: string;

  tenantId: number;
  createdAt: any;
  createdBy?: ActionBy;

  // Soft delete = void
  isDeleted: boolean;
  isDeletedAt?: any;
  deletedBy?: ActionBy;
  voidReason?: string;
}
