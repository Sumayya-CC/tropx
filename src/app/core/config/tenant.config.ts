export interface Tenant {
  id: number;
  name: string;
}

// Numeric IDs are cheaper to index and compare in Firestore queries than strings
export const TENANT_ID = 1;
export const TENANT_NAME = 'tropx';

export const CURRENT_TENANT: Tenant = {
  id: TENANT_ID,
  name: TENANT_NAME,
};
