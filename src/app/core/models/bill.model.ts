import { ActionBy } from './action-by.model';

export type BillStatus = 'unpaid' | 'partial' | 'paid';

export interface BillLineItem {
  description: string;
  quantity?: number;
  unitCents?: number;
  lineTotalCents: number;
}

export interface Bill {
  id: string;
  billNumber: string;          // BILL-2026-0001
  supplierId: string;
  supplierName: string;        // snapshot

  linkedPurchaseOrderId?: string;
  linkedPurchaseOrderNumber?: string;  // snapshot

  billDate: any;
  dueDate?: any;

  lineItems?: BillLineItem[];

  subtotalCents: number;
  taxCents: number;
  totalCents: number;

  status: BillStatus;
  amountPaidCents: number;
  balanceCents: number;        // totalCents - amountPaidCents

  notes?: string;
  tenantId: number;
  createdAt: any;
  createdBy?: ActionBy;
  isDeleted: boolean;
  isDeletedAt?: any;
  deletedBy?: ActionBy;
}

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partial',
  paid: 'Paid',
};
