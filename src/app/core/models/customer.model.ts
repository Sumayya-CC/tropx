import { ActionBy } from './action-by.model';

export interface Address {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export type CustomerStatus = 'active' | 'suspended' | 'pending' | 'rejected';
export type CustomerSource = 'access_request' | 'admin_created';

export interface Customer {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  logoUrl?: string;
  businessType?: string;
  businessTypeCustom?: string;
  notes?: string;
  address: Address;
  // Manual coordinates avoid expensive auto-geocoding for future route planning
  coordinates?: Coordinates;
  serviceAreaId?: string;
  // Custom text avoids polluting serviceArea collection with one-off entries
  serviceAreaCustom?: string;
  status: CustomerStatus;
  source: CustomerSource;
  linkedUserId?: string;
  linkedRequestId?: string;
  tenantId: number;
  createdAt: Date;
  createdBy?: ActionBy;
  approvedBy?: ActionBy;

  // Denormalized totals enable dashboard display without expensive aggregate queries
  totalOrderedCents: number;
  totalPaidCents: number;
  totalOwingCents: number;
  // Storing code alongside cents avoids currency ambiguity in reports
  currencyCode: string;
  lastOrderAt?: Date;
  lastPaymentAt?: Date;

  isDeleted: boolean;
  isDeletedAt?: Date;
  deletedBy?: ActionBy;
}
