import { UserRole } from '../models/user.model';

/**
 * WHY: These configurations act as a single source of truth for all role-related dropdowns 
 * and displays. This prevents "magic strings" from being scattered across components 
 * and templates, ensuring that labels and descriptions remain consistent throughout the app.
 */

export interface RoleOption {
  value: UserRole;
  label: string;
  description: string;
}

export const USER_ROLES: RoleOption[] = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full system access including employee management and platform settings',
  },
  {
    value: 'manager',
    label: 'Manager',
    description: 'Management access for products, orders, and customer approvals',
  },
  {
    value: 'sales_rep',
    label: 'Sales Rep',
    description: 'Field access to view products, manage assigned orders, and add customers',
  },
  {
    value: 'warehouse',
    label: 'Warehouse',
    description: 'Inventory management, stock adjustments, and order fulfillment access',
  },
  {
    value: 'customer',
    label: 'Customer',
    description: 'Standard B2B customer access for browsing catalog and placing orders',
  },
];

/**
 * Filtered list excluding 'customer' for use in employee management forms 
 * where the customer role should never be assigned manually.
 */
export const STAFF_ROLES: RoleOption[] = USER_ROLES.filter((role) => role.value !== 'customer');
