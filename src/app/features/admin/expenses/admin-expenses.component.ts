import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { SettingsService } from '../../../core/services/settings.service';
import { ToastService } from '../../../shared/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { Expense } from '../../../core/models/expense.model';
import { where } from '@angular/fire/firestore';
import { TENANT_ID } from '../../../core/config/tenant.config';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { ExpenseFormModalComponent } from './expense-form-modal/expense-form-modal.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';

type MonthFilter = 'this_month' | 'last_month' | 'all';

@Component({
  selector: 'app-admin-expenses',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingSpinnerComponent, ExpenseFormModalComponent],
  templateUrl: './admin-expenses.component.html',
  styleUrl: './admin-expenses.component.scss'
})
export class AdminExpensesComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  protected readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  centsToDisplay = centsToDisplay;

  // State
  expenses = signal<Expense[]>([]);
  isLoading = signal(true);
  isModalOpen = signal(false);
  isFuelPreset = signal(false);
  selectedExpense = signal<Expense | null>(null);

  // Filters
  monthFilter = signal<MonthFilter>('this_month');
  categoryFilter = signal<string>('all');

  monthOptions = [
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'all', label: 'All Time' },
  ];

  categoryOptions = computed(() => [
    { value: 'all', label: 'All Categories' },
    ...(this.settings.expenses().categories ?? []).map(c => ({ value: c.value, label: c.label })),
  ]);

  // In-month expenses (before category filter) — feeds the summary cards
  monthExpenses = computed(() => {
    const active = this.expenses().filter(e => !e.isDeleted);
    return active.filter(e => this.inMonthRange(e.expenseDate));
  });

  filteredExpenses = computed(() => {
    let list = this.monthExpenses();
    if (this.categoryFilter() !== 'all') {
      list = list.filter(e => e.category === this.categoryFilter());
    }
    return [...list].sort((a, b) => this.toDate(b.expenseDate).getTime() - this.toDate(a.expenseDate).getTime());
  });

  categorySummary = computed(() => {
    const byCategory = new Map<string, number>();
    for (const e of this.monthExpenses()) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountCents);
    }
    const options = this.settings.expenses().categories ?? [];
    return Array.from(byCategory.entries())
      .map(([category, amountCents]) => {
        const opt = options.find(o => o.value === category);
        return { category, label: opt?.label ?? category, icon: opt?.icon, amountCents };
      })
      .sort((a, b) => b.amountCents - a.amountCents);
  });

  totalThisPeriod = computed(() => this.monthExpenses().reduce((sum, e) => sum + e.amountCents, 0));

  constructor() {
    this.loadExpenses();
  }

  loadExpenses() {
    this.isLoading.set(true);
    this.firestore.getCollection<Expense>('expenses', where('tenantId', '==', TENANT_ID)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.expenses.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading expenses', err);
        this.isLoading.set(false);
      }
    });
  }

  categoryIcon(category: string): string {
    return this.settings.expenses().categories?.find(c => c.value === category)?.icon ?? '💰';
  }

  categoryLabel(category: string): string {
    return this.settings.expenses().categories?.find(c => c.value === category)?.label ?? category;
  }

  openNewModal() {
    this.selectedExpense.set(null);
    this.isFuelPreset.set(false);
    this.isModalOpen.set(true);
  }

  openFuelModal() {
    this.selectedExpense.set(null);
    this.isFuelPreset.set(true);
    this.isModalOpen.set(true);
  }

  openEditModal(expense: Expense) {
    this.selectedExpense.set(expense);
    this.isFuelPreset.set(false);
    this.isModalOpen.set(true);
  }

  closeModal(refresh: boolean) {
    this.isModalOpen.set(false);
    this.selectedExpense.set(null);
    this.isFuelPreset.set(false);
    if (refresh) this.loadExpenses();
  }

  async deleteExpense(expense: Expense) {
    if (!confirm(`Delete this ${this.categoryLabel(expense.category)} expense of ${centsToDisplay(expense.amountCents)}?`)) return;
    try {
      await this.firestore.softDelete(`expenses/${expense.id}`, this.auth.getActionBy()?.uid || 'unknown');
      this.toast.success('Expense deleted');
      this.loadExpenses();
    } catch (e) {
      console.error('Delete expense error', e);
      this.toast.error('Failed to delete expense');
    }
  }

  formatDate(value: any): string {
    const d = this.toDate(value);
    if (!d.getTime()) return '—';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private inMonthRange(value: any): boolean {
    const filter = this.monthFilter();
    if (filter === 'all') return true;
    const d = this.toDate(value);
    const now = new Date();
    if (filter === 'this_month') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    // last_month
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === lastMonth.getFullYear() && d.getMonth() === lastMonth.getMonth();
  }

  private toDate(value: any): Date {
    if (!value) return new Date(0);
    return value.toDate ? value.toDate() : new Date(value);
  }
}
