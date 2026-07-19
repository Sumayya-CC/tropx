import { ActionBy } from './action-by.model';

export interface Expense {
  id: string;
  category: string;            // validated against settings/expenses.categories, not a fixed union
  amountCents: number;
  expenseDate: any;            // Using any to handle Firestore Timestamp vs Date

  linkedVisitId?: string;
  linkedRouteId?: string;

  vendor?: string;
  note?: string;
  receiptUrl?: string;

  tenantId: number;
  createdAt: any;
  createdBy?: ActionBy;
  isDeleted: boolean;
  isDeletedAt?: any;
  deletedBy?: ActionBy;
}
