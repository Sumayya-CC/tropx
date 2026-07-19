import { Component, inject, signal, computed, output, input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Storage } from '@angular/fire/storage';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Expense } from '../../../../core/models/expense.model';
import { serverTimestamp } from '@angular/fire/firestore';
import { TENANT_ID } from '../../../../core/config/tenant.config';
import { dateInputToLocalDate, toDateInputValue, todayInputValue } from '../../../../shared/utils/date.utils';

@Component({
  selector: 'app-expense-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './expense-form-modal.component.html',
  styleUrl: './expense-form-modal.component.scss'
})
export class ExpenseFormModalComponent implements OnInit {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(Storage);
  protected readonly settings = inject(SettingsService);

  // Inputs
  expense = input<Expense | null>(null);
  presetCategory = input<string | undefined>();
  presetAmountCents = input<number | undefined>();
  linkedVisitId = input<string | undefined>();
  linkedRouteId = input<string | undefined>();
  title = input<string>('Log Expense');

  // Outputs
  closed = output<boolean>();

  // State
  isSaving = signal(false);
  isEditing = computed(() => !!this.expense());

  // Form fields
  category = signal('');
  amount = signal<number>(0); // dollars — converted to cents on save
  expenseDateStr = signal(todayInputValue());
  vendor = signal('');
  note = signal('');
  receiptUrl = signal<string | null>(null);
  receiptFile = signal<File | null>(null);
  isUploadingReceipt = signal(false);

  amountCents = computed(() => Math.round(this.amount() * 100));
  categoryOptions = computed(() => this.settings.expenses().categories ?? []);

  isValid = computed(() => !!this.category() && this.amountCents() > 0);

  ngOnInit() {
    const existing = this.expense();
    if (existing) {
      this.category.set(existing.category);
      this.amount.set(existing.amountCents / 100);
      this.expenseDateStr.set(toDateInputValue(existing.expenseDate) || todayInputValue());
      this.vendor.set(existing.vendor ?? '');
      this.note.set(existing.note ?? '');
      this.receiptUrl.set(existing.receiptUrl ?? null);
      return;
    }

    const preset = this.presetCategory();
    this.category.set(preset ?? this.categoryOptions()[0]?.value ?? '');
    if (this.presetAmountCents() != null) {
      this.amount.set((this.presetAmountCents() ?? 0) / 100);
    }
  }

  cancel() {
    this.closed.emit(false);
  }

  onReceiptSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.receiptFile.set(file);
  }

  removeReceipt() {
    this.receiptFile.set(null);
    this.receiptUrl.set(null);
  }

  private async uploadReceiptIfNeeded(): Promise<string | null> {
    const file = this.receiptFile();
    if (!file) return this.receiptUrl();
    this.isUploadingReceipt.set(true);
    try {
      const { ref, uploadBytes, getDownloadURL } = await import('@angular/fire/storage');
      const path = `expenses/receipts/${Date.now()}_${file.name}`;
      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, file);
      return await getDownloadURL(storageRef);
    } finally {
      this.isUploadingReceipt.set(false);
    }
  }

  async save() {
    if (!this.isValid()) {
      if (!this.category()) this.toast.warning('Please select a category');
      else this.toast.warning('Amount must be greater than 0');
      return;
    }

    const actionBy = this.auth.getActionBy();
    if (!actionBy) {
      this.toast.error('User session not found');
      return;
    }

    this.isSaving.set(true);
    try {
      const existing = this.expense();
      const expenseDate = dateInputToLocalDate(this.expenseDateStr());
      let receiptUrl: string | null;
      try {
        receiptUrl = await this.uploadReceiptIfNeeded();
      } catch (e) {
        console.error('Receipt upload error', e);
        this.toast.error('Failed to upload receipt — expense not saved');
        return;
      }

      if (existing) {
        await this.firestore.updateDocument(`expenses/${existing.id}`, {
          category: this.category(),
          amountCents: this.amountCents(),
          expenseDate,
          vendor: this.vendor().trim() || null,
          note: this.note().trim() || null,
          receiptUrl: receiptUrl || null,
        });
      } else {
        const visitId = this.linkedVisitId();
        const routeId = this.linkedRouteId();
        const vendor = this.vendor().trim();
        const note = this.note().trim();

        await this.firestore.addDocument<Omit<Expense, 'id'>>('expenses', {
          category: this.category(),
          amountCents: this.amountCents(),
          expenseDate,
          ...(visitId && { linkedVisitId: visitId }),
          ...(routeId && { linkedRouteId: routeId }),
          ...(vendor && { vendor }),
          ...(note && { note }),
          ...(receiptUrl && { receiptUrl }),
          tenantId: TENANT_ID,
          createdAt: serverTimestamp(),
          createdBy: actionBy,
          isDeleted: false,
        });
      }

      this.toast.success(existing ? 'Expense updated' : 'Expense logged');
      this.closed.emit(true);
    } catch (e) {
      console.error('Expense save error', e);
      this.toast.error('Failed to save expense');
    } finally {
      this.isSaving.set(false);
    }
  }
}
