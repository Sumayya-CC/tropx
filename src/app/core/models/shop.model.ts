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
  productId?: string;          // catalog SKU; undefined for free-text
  productName: string;         // always present
  left?: number;               // on shelf at start (auto-filled from last visit)
  found?: number;              // still there now
  added?: number;              // restocked this visit
  soldSinceLastVisit?: number; // computed on save: left - found (>=0)
  isSample?: boolean;          // sample giveaway
  sampleQty?: number;          // qty sampled ($0, adjusts stock for catalog items)
}

export type VisitOutcome =
  | 'ordered'
  | 'restocked'
  | 'no_action'
  | 'follow_up'
  | 'not_interested'
  | 'sample_left'
  | 'converted';

export interface Visit {
  id: string;
  shopId: string;
  visitDate: Date;
  items: VisitItem[];
  outcome?: VisitOutcome;
  managerAvailable?: boolean;
  notes?: string;
  markedConversion?: boolean;
  restockOrderId?: string;   // set when an order was created from this visit's restock

  visitedBy: ActionBy;
  tenantId: number;
  createdAt: Date;
  isDeleted: boolean;
  isDeletedAt?: Date;
  deletedBy?: ActionBy;
}
