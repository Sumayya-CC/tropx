import { ActionBy } from './action-by.model';

export type UserRole = 'admin' | 'manager' | 'sales_rep' | 'warehouse' | 'customer';
export type UserStatus = 'active' | 'suspended';

export interface AppUser {
  // Using Auth UID as Doc ID enables 1:1 mapping and simple security rules
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: UserRole;
  status: UserStatus;
  // Links auth account to specific retail profile when role is customer
  linkedCustomerId?: string;
  tenantId: number;
  createdAt: Date;
  lastLoginAt: Date;
  createdBy?: ActionBy;
  // Soft delete preserves audit trails and prevents dangling order references
  isDeleted: boolean;
  isDeletedAt?: Date;
  deletedBy?: ActionBy;
}

/**
 * WHY: Computed helper to ensure consistent full name formatting 
 * throughout the app without storing redundant data in Firestore.
 */
export function getFullName(user: AppUser): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
