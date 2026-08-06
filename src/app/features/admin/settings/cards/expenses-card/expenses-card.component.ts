import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-expenses-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './expenses-card.component.html',
})
export class ExpensesCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingExpenses = signal(false);
  isSaving = signal(false);

  expDefaultFuel = signal(30); // dollars, converted to cents on save
  expFuelReminder = signal(true);
  expCategories = signal<{value: string; label: string; icon?: string}[]>([]);

  constructor() {
    effect(() => {
      const exp = this.settings.expenses();
      this.expDefaultFuel.set((exp.defaultFuelCents ?? 3000) / 100);
      this.expFuelReminder.set(exp.fuelReminderOnVisit ?? true);
      this.expCategories.set([...(exp.categories ?? [])]);
    }, { allowSignalWrites: true });
  }

  async saveExpenses() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/expenses', {
        defaultFuelCents: Math.round(this.expDefaultFuel() * 100),
        fuelReminderOnVisit: this.expFuelReminder(),
        categories: this.expCategories(),
      });
      this.toast.success('Expense settings saved');
      this.editingExpenses.set(false);
    } catch (e) { console.error(e); this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelExpenses() {
    const exp = this.settings.expenses();
    this.expDefaultFuel.set((exp.defaultFuelCents ?? 3000) / 100);
    this.expFuelReminder.set(exp.fuelReminderOnVisit ?? true);
    this.expCategories.set([...(exp.categories ?? [])]);
    this.editingExpenses.set(false);
  }

  addExpenseCategory() {
    this.expCategories.update(c => [...c, { value: '', label: '', icon: '' }]);
  }
  removeExpenseCategory(idx: number) {
    this.expCategories.update(c => c.filter((_, i) => i !== idx));
  }
  updateExpenseCategoryLabel(idx: number, label: string) {
    this.expCategories.update(c => c.map((cat, i) => i === idx
      ? { ...cat, label, value: cat.value || label.trim().toLowerCase().replace(/\s+/g, '_') }
      : cat));
  }
  updateExpenseCategoryIcon(idx: number, icon: string) {
    this.expCategories.update(c => c.map((cat, i) => i === idx ? { ...cat, icon } : cat));
  }
}
