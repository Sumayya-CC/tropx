export interface Warehouse {
  id: string; tenantId: number; isDeleted: boolean;
  name: string; code: string;
  street?: string; city?: string; province?: string; postalCode?: string; country?: string;
  isDefault: boolean; active: boolean;
  createdAt?: any; createdBy?: any;
}
