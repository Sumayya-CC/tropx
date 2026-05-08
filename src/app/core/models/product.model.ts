import { ActionBy } from './action-by.model';

export type ProductUnit =
  | 'mL' | 'L' | 'g' | 'kg' | 'pcs'
  | 'packets' | 'boxes' | 'bottles' | 'cans' | 'bags' | 'other';

export interface ProductMeasurement {
  quantity: number;
  unit: ProductUnit;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  // Uniqueness enforced via transaction to prevent race conditions during creation
  sku: string;
  barcode?: string;
  measurement: ProductMeasurement;
  // Cents (integers) avoid float rounding errors in financial math
  priceCents: number;
  // Cost visible only to staff for margin calculations
  costCents: number;
  currencyCode: string;
  imageUrl: string;
  stock: number;
  lowStockThreshold: number;
  // Inactive products hidden from customer catalog but editable by staff
  active: boolean;
  tenantId: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: ActionBy;
  isDeleted: boolean;
  isDeletedAt?: Date;
  deletedBy?: ActionBy;
}
