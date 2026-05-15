import { ActionBy } from './action-by.model';

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccessRequest {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  businessType: string;
  businessTypeCustom?: string;
  address: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
  serviceAreaId?: string;
  serviceAreaCustom?: string;
  message?: string;
  status: AccessRequestStatus;
  tenantId: number;
  submittedAt?: any;
  createdAt: any;
  reviewedAt?: any;
  reviewedBy?: ActionBy;
  linkedCustomerId?: string;
  linkedUserId?: string;
  internalNotes?: string;
  isDeleted: boolean;
}
