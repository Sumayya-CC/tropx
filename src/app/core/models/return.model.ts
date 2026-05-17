import { ActionBy } from './action-by.model';

export type ReturnType = 'credit_note' | 'refund';
export type ReturnStatus = 
  | 'pending'    // Created, awaiting processing
  | 'approved'   // Approved, financials updated
  | 'rejected';  // Rejected, no financial impact

export type ReturnReasonCode =
  | 'damaged'
  | 'wrong_item'
  | 'customer_changed_mind'
  | 'expired'
  | 'quality_issue'
  | 'other';

export type RefundMethod = 'cash' | 'e_transfer' | 'store_credit';

export interface ReturnItem {
  productId: string;
  productName: string;    // snapshot
  productSku: string;     // snapshot
  quantity: number;
  unitPriceCents: number; // snapshot from order
  lineTotalCents: number; // quantity × unitPrice
}

export interface Return {
  id: string;
  returnNumber: string;         // RET-2026-0001
  orderId: string;
  orderNumber: string;          // snapshot
  customerId: string;
  customerName: string;         // snapshot
  customerPhone: string;        // snapshot
  type: ReturnType;
  status: ReturnStatus;
  items: ReturnItem[];
  amountCents: number;          // total value of return
  reasonCode: ReturnReasonCode;
  reason: string;               // text description
  internalNotes?: string | null;
  // For refunds only
  refundMethod?: RefundMethod;
  refundedAt?: any;
  refundedBy?: ActionBy;
  refundReferenceNumber?: string;
  // Stock
  stockRestored: boolean;
  stockAdjustmentIds: string[]; // linked adjustments
  // Review
  processedBy?: ActionBy;
  processedAt?: any;
  rejectionReason?: string;
  tenantId: number;
  createdAt: any;
  createdBy: ActionBy;
  isDeleted: boolean;
  isDeletedAt?: any;
  deletedBy?: ActionBy;
}

export const RETURN_TYPE_LABELS: Record<ReturnType, string> = {
  credit_note: 'Credit Note',
  refund: 'Refund',
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const RETURN_REASON_LABELS: 
  Record<ReturnReasonCode, string> = {
  damaged: 'Damaged / Defective',
  wrong_item: 'Wrong Item',
  customer_changed_mind: 'Customer Changed Mind',
  expired: 'Expired / Past Best Before',
  quality_issue: 'Quality Issue',
  other: 'Other',
};

export const REFUND_METHOD_LABELS: 
  Record<RefundMethod, string> = {
  cash: 'Cash',
  e_transfer: 'E-Transfer',
  store_credit: 'Store Credit',
};
