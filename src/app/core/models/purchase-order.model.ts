export type PurchaseOrderStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';
export interface PurchaseOrderItem {
  productId: string; productName: string; productSku: string;
  quantityOrdered: number; quantityReceived: number;
  unitCostCents: number; lineTotalCents: number;
}
export interface PurchaseOrder {
  id: string; tenantId: number; isDeleted: boolean;
  poNumber: string;
  supplierId: string; supplierName: string;
  warehouseId: string; warehouseName: string;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  subtotalCents: number; taxRatePercent: number; taxCents: number; totalCents: number;
  orderDate: any; expectedDate?: any; notes?: string;
  createdAt?: any; createdBy?: any; sentAt?: any; receivedAt?: any;
  cancelledAt?: any; cancelledBy?: any; cancellationReason?: string;
}
export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft', sent: 'Sent', partially_received: 'Partially Received',
  received: 'Received', cancelled: 'Cancelled',
};
