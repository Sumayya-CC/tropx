export interface StockNotificationRequest {
  id?: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  productId: string;
  productName: string;
  productSku: string;
  createdAt: Date;
  status: 'pending' | 'notified';
  notifiedAt?: Date | null;
}
