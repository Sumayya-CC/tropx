export interface Supplier {
  id: string; tenantId: number; isDeleted: boolean;
  name: string; displayName: string;
  contactFirstName?: string; contactLastName?: string;
  email?: string; phone?: string;
  street?: string; city?: string; province?: string; postalCode?: string; country?: string;
  paymentTermsDays: number; leadTimeDays: number; currencyCode: string;
  notes?: string; active: boolean;
  createdAt?: any; createdBy?: any;
}
