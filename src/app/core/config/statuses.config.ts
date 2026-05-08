/**
 * WHY: Centralizing status definitions ensures that labels, descriptions, and color 
 * associations are uniform across the entire application. Updating a status label 
 * or hint color here will automatically reflect in every dropdown and badge.
 */

export interface StatusOption {
  value: string;
  label: string;
  description?: string;
  colorHint?: string;
}

export const USER_STATUSES: StatusOption[] = [
  { value: 'active', label: 'Active', description: 'Can log in normally' },
  { value: 'suspended', label: 'Suspended', description: 'Cannot log in, account frozen' },
];

export const CUSTOMER_STATUSES: StatusOption[] = [
  { value: 'pending', label: 'Pending', description: 'Newly registered, awaiting manager approval' },
  { value: 'active', label: 'Active', description: 'Approved and can place orders' },
  { value: 'suspended', label: 'Suspended', description: 'Access temporarily revoked' },
  { value: 'rejected', label: 'Rejected', description: 'Application denied' },
];

export const ORDER_STATUSES: StatusOption[] = [
  { value: 'pending', label: 'Pending', colorHint: '--navy' },
  { value: 'delivered', label: 'Delivered', colorHint: '--gold' },
  { value: 'paid', label: 'Paid', colorHint: '--green' },
  { value: 'voided', label: 'Voided', colorHint: '--gray' },
];

export const PAYMENT_STATUSES: StatusOption[] = [
  { value: 'unpaid', label: 'Unpaid', colorHint: '--red' },
  { value: 'partial', label: 'Partial', colorHint: '--gold' },
  { value: 'paid', label: 'Paid', colorHint: '--green' },
];

export const PAYMENT_METHODS: StatusOption[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'e_transfer', label: 'E-Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export interface AdjustmentTypeOption extends StatusOption {
  effect: 'decrease' | 'increase' | 'either';
}

export const ADJUSTMENT_TYPES: AdjustmentTypeOption[] = [
  {
    value: 'DAMAGED',
    label: 'Damaged',
    description: 'Items physically damaged and unsellable',
    effect: 'decrease',
  },
  {
    value: 'EXPIRED',
    label: 'Expired',
    description: 'Product reached expiration date',
    effect: 'decrease',
  },
  {
    value: 'SAMPLE',
    label: 'Sample',
    description: 'Distributed for marketing or testing',
    effect: 'decrease',
  },
  {
    value: 'LOST',
    label: 'Lost',
    description: 'Missing from inventory during count',
    effect: 'decrease',
  },
  {
    value: 'RETURN_FROM_CUSTOMER',
    label: 'Return from Customer',
    description: 'Product returned and put back in stock',
    effect: 'increase',
  },
  {
    value: 'RECEIVED',
    label: 'Received',
    description: 'Inbound shipment from supplier',
    effect: 'increase',
  },
  {
    value: 'CORRECTION',
    label: 'Correction',
    description: 'General adjustment to match physical count',
    effect: 'either',
  },
  {
    value: 'OTHER',
    label: 'Other',
    description: 'Unspecified adjustment reason',
    effect: 'either',
  },
];
