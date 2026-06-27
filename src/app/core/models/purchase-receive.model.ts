export interface PurchaseReceiveItem {
  productId: string; productName: string; productSku: string;
  quantityReceived: number; previousStock: number; newStock: number;
}
export interface PurchaseReceive {
  id: string; tenantId: number; isDeleted: boolean;
  receiveNumber: string;
  purchaseOrderId: string; poNumber: string;
  supplierId: string; supplierName: string;
  warehouseId: string; warehouseName: string;
  items: PurchaseReceiveItem[];
  receivedDate: any; notes?: string;
  createdAt?: any; createdBy?: any;
}
