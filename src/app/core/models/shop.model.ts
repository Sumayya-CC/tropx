import { Address, Coordinates } from './customer.model';
import { ActionBy } from './action-by.model';

export type ShopStatus = 'prospect' | 'customer' | 'not_interested' | 'dormant';

export type PipelineStage =
  | 'first_contact'
  | 'manager_meeting'
  | 'sample_left'
  | 'decision'
  | 'opened';

export interface Shop {
  id: string;
  name: string;
  address?: Address;
  coordinates?: Coordinates;

  ownerFirstName?: string;
  ownerLastName?: string;
  managerFirstName?: string;
  managerLastName?: string;
  phone?: string;
  bestVisitTime?: string;
  otherStoresOwned?: string;
  productsOfInterest?: string[];
  notes?: string;

  status: ShopStatus;
  pipelineStage?: PipelineStage;

  linkedCustomerId?: string;
  hasCustomer?: boolean;
  searchName?: string;
  inactiveDaysOverride?: number; // Phase 3 — defined now to avoid a later model edit

  tenantId: number;
  createdAt: Date;
  createdBy?: ActionBy;
  isDeleted: boolean;
  isDeletedAt?: Date;
  deletedBy?: ActionBy;
}

export interface VisitItem {
  productId?: string;
  productName: string;
  left?: number;
  found?: number;
  added?: number;
}

export type VisitOutcome =
  | 'ordered' | 'no_order' | 'follow_up' | 'not_interested' | 'sample_left';

export interface Visit {
  id: string;
  shopId: string;
  visitDate: Date;
  items: VisitItem[];
  outcome?: VisitOutcome;
  notes?: string;
  managerAvailable?: boolean;
  fuelCents?: number;
  visitedBy: ActionBy;

  tenantId: number;
  createdAt: Date;
  isDeleted: boolean;
  isDeletedAt?: Date;
  deletedBy?: ActionBy;
}
