import { ActionBy } from './action-by.model';

export type AdjustmentType = 
  | 'received'      // New stock received from supplier
  | 'sold'          // Manual sale entry (not from order)
  | 'damaged'       // Damaged/expired goods
  | 'returned'      // Customer return
  | 'correction'    // Manual count correction
  | 'transfer';     // Transferred to another location

export interface StockAdjustment {
  id: string;
  productId: string;
  productName: string;        // snapshot at time of adjustment
  productSku: string;         // snapshot at time of adjustment
  type: AdjustmentType;
  // Positive = stock IN (received, returned, correction-up)
  // Negative = stock OUT (sold, damaged, transfer, correction-down)
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string;             // required short reason
  notes: string;              // optional longer notes
  adjustedBy: ActionBy;
  createdAt: any;             // Using any to handle Firestore Timestamp vs Date
  tenantId: number;
  isDeleted: boolean;
}

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  received: 'Received',
  sold: 'Sold',
  damaged: 'Damaged',
  returned: 'Returned',
  correction: 'Correction',
  transfer: 'Transfer'
};

// Indicates direction for UI (whether this type adds or removes stock)
export const ADJUSTMENT_TYPE_DIRECTION: Record<AdjustmentType, 'in' | 'out' | 'either'> = {
  received: 'in',
  sold: 'out',
  damaged: 'out',
  returned: 'in',
  correction: 'either',
  transfer: 'out'
};
