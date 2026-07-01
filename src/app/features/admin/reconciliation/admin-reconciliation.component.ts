import {
  Component, inject, signal, computed, effect
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  where, doc, getDoc,
  serverTimestamp, Firestore
} from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';

interface DriftEntry {
  counter: string;
  stored: number;
  correct: number;
  delta: number;
}

interface ReconLogEntry {
  id: string;
  customerId: string;
  businessName: string;
  status: 'needs_review' | 'resolved' | 'dismissed';
  drifts: DriftEntry[];
  maxAbsDelta: number;
  reason: string;
  detectedAt: any;
  resolvedAt: any;
  resolvedBy: any;
  dismissedAt?: any;
  dismissedBy?: any;
  dismissNote?: string;
  tenantId: number;
}

@Component({
  selector: 'app-admin-reconciliation',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    PageHeaderComponent,
    LoadingSpinnerComponent,
  ],
  templateUrl: './admin-reconciliation.component.html',
  styleUrl: './admin-reconciliation.component.scss',
})
export class AdminReconciliationComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly firestoreDb = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  protected readonly router = inject(Router);

  // ── Data ──────────────────────────────────────────────

  private needsReview$ = this.firestore.getCollection<ReconLogEntry>(
    'reconciliationLog',
    where('tenantId', '==', 1),
    where('status', '==', 'needs_review')
  );

  private dismissed$ = this.firestore.getCollection<ReconLogEntry>(
    'reconciliationLog',
    where('tenantId', '==', 1),
    where('status', '==', 'dismissed')
  );

  needsReviewItems = toSignal(this.needsReview$, {
    initialValue: [] as ReconLogEntry[]
  });

  dismissedItems = toSignal(this.dismissed$, {
    initialValue: [] as ReconLogEntry[]
  });

  needsReviewSorted = computed(() =>
    [...this.needsReviewItems()].sort(
      (a, b) => Math.abs(b.maxAbsDelta) - Math.abs(a.maxAbsDelta)
    )
  );

  dismissedSorted = computed(() =>
    [...this.dismissedItems()].sort((a, b) => {
      const at = a.dismissedAt?.seconds ?? 0;
      const bt = b.dismissedAt?.seconds ?? 0;
      return bt - at;
    })
  );

  isLoading = computed(() =>
    this.needsReviewItems().length === 0 &&
    this.dismissedItems().length === 0
  );

  // ── Selected item + side panel ────────────────────────

  selectedEntry = signal<ReconLogEntry | null>(null);
  private autoSelected = signal(false);

  constructor() {
    // Auto-select the first needs_review item when data loads,
    // but only once — don't override a user's manual selection.
    effect(() => {
      const items = this.needsReviewSorted();

      if (this.autoSelected()) {
        // If the currently selected item was resolved/dismissed
        // and is no longer in needs_review, clear the panel.
        const selected = this.selectedEntry();
        if (selected && !items.find(i => i.id === selected.id)) {
          this.selectedEntry.set(
            items.length > 0 ? items[0] : null
          );
          if (items.length > 0) {
            this.loadCustomerDetail(items[0].customerId);
          }
        }
        return;
      }

      if (items.length === 0) return;
      this.selectedEntry.set(items[0]);
      this.autoSelected.set(true);
      this.loadCustomerDetail(items[0].customerId);
    }, { allowSignalWrites: true });
  }

  isApplying = signal(false);
  isDismissing = signal(false);
  dismissNote = signal('');
  showDismissForm = signal(false);

  // Orders for the investigation section.
  customerOrders = signal<any[]>([]);
  customerPayments = signal<any[]>([]);
  isLoadingDetail = signal(false);

  selectEntry(entry: ReconLogEntry) {
    this.selectedEntry.set(entry);
    this.showDismissForm.set(false);
    this.dismissNote.set('');
    this.loadCustomerDetail(entry.customerId);
  }

  closePanel() {
    this.selectedEntry.set(null);
    this.showDismissForm.set(false);
    this.dismissNote.set('');
    this.customerOrders.set([]);
    this.customerPayments.set([]);
  }

  private async loadCustomerDetail(customerId: string) {
    this.isLoadingDetail.set(true);
    try {
      this.firestore.getCollection<any>(
        'orders',
        where('customerId', '==', customerId),
        where('tenantId', '==', 1)
      ).subscribe(orders => {
        this.customerOrders.set(
          orders
            .filter(o => !o.isDeleted && o.status !== 'cancelled')
            .sort((a, b) => {
              const at = a.confirmedAt?.seconds ?? 0;
              const bt = b.confirmedAt?.seconds ?? 0;
              return bt - at;
            })
            .slice(0, 10)
        );
      });

      this.firestore.getCollection<any>(
        'payments',
        where('customerId', '==', customerId),
        where('tenantId', '==', 1)
      ).subscribe(payments => {
        this.customerPayments.set(
          payments
            .filter(p => !p.isDeleted)
            .sort((a, b) =>
              (b.receivedDate || '').localeCompare(
                a.receivedDate || ''
              )
            )
            .slice(0, 10)
        );
        this.isLoadingDetail.set(false);
      });
    } catch (err) {
      console.error('Failed to load customer detail', err);
      this.isLoadingDetail.set(false);
    }
  }

  // ── Apply correction ──────────────────────────────────

  async applyCorrection() {
    const entry = this.selectedEntry();
    const actionBy = this.auth.getActionBy();
    if (!entry || !actionBy) return;

    if (!confirm(
      `Apply correction to ${entry.businessName}?\n\n` +
      `This will write the recomputed values to their ` +
      `counters. The action is logged.`
    )) return;

    this.isApplying.set(true);
    try {
      await this.firestore.runBatch(async (batch, db) => {
        const { doc: docFn } =
          await import('@angular/fire/firestore');

        // 1. Write the correct values to the customer doc.
        const customerRef = docFn(
          db, `customers/${entry.customerId}`
        );
        const customerSnap = await getDoc(customerRef);
        if (!customerSnap.exists()) {
          throw new Error('Customer not found');
        }

        // Build update from the drifts — only write the
        // counters that actually drifted.
        const counterUpdate: Record<string, number> = {};
        for (const d of entry.drifts) {
          counterUpdate[d.counter] = d.correct;
        }

        batch.update(customerRef, {
          ...counterUpdate,
          // Clear the dismissed marker — counter is now
          // truthful so suppression is no longer needed.
          reconciliationDismissedValue:
            null,
          countersReconciledAt:
            serverTimestamp(),
        });

        // 2. Mark the log entry resolved.
        const logRef = docFn(
          db, `reconciliationLog/${entry.id}`
        );
        batch.update(logRef, {
          status: 'resolved',
          resolvedAt: serverTimestamp(),
          resolvedBy: actionBy,
        });
      });

      this.toast.success(
        `Counters corrected for ${entry.businessName}`
      );
      this.closePanel();
    } catch (err) {
      console.error('Apply correction failed', err);
      this.toast.error('Failed to apply correction');
    } finally {
      this.isApplying.set(false);
    }
  }

  // ── Dismiss ───────────────────────────────────────────

  async confirmDismiss() {
    const entry = this.selectedEntry();
    const actionBy = this.auth.getActionBy();
    if (!entry || !actionBy) return;

    this.isDismissing.set(true);
    try {
      await this.firestore.runBatch(async (batch, db) => {
        const { doc: docFn } =
          await import('@angular/fire/firestore');

        // 1. Stamp the customer doc with the current stored
        //    owing value so the reconciler knows this drift
        //    was deliberately set aside. If the value later
        //    changes (new order, payment) it re-alerts.
        const owingDrift = entry.drifts.find(
          d => d.counter === 'totalOwingCents'
        );
        const customerRef = docFn(
          db, `customers/${entry.customerId}`
        );
        batch.update(customerRef, {
          reconciliationDismissedValue: {
            totalOwingCents: owingDrift?.stored ?? 0,
            dismissedAt: serverTimestamp(),
          },
        });

        // 2. Mark the log entry dismissed.
        const logRef = docFn(
          db, `reconciliationLog/${entry.id}`
        );
        batch.update(logRef, {
          status: 'dismissed',
          dismissedAt: serverTimestamp(),
          dismissedBy: actionBy,
          dismissNote: this.dismissNote().trim() || null,
        });
      });

      this.toast.success(
        `${entry.businessName} set aside for investigation`
      );
      this.closePanel();
    } catch (err) {
      console.error('Dismiss failed', err);
      this.toast.error('Failed to dismiss');
    } finally {
      this.isDismissing.set(false);
      this.showDismissForm.set(false);
    }
  }

  // ── Utils ─────────────────────────────────────────────

  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  formatDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric',
      year: 'numeric', hour: '2-digit',
      minute: '2-digit',
    });
  }

  counterLabel(counter: string): string {
    const map: Record<string, string> = {
      totalOwingCents: 'Owing',
      totalOrderedCents: 'Ordered',
      totalPaidCents: 'Paid',
    };
    return map[counter] || counter;
  }

  reasonLabel(reason: string): string {
    const map: Record<string, string> = {
      above_max_threshold: 'Exceeds auto-correct limit',
      auto_correct_disabled: 'Auto-correct is off',
    };
    return map[reason] || reason;
  }

  getOrderStatusColor(status: string): string {
    const map: Record<string, string> = {
      confirmed: '#16588e',
      out_for_delivery: '#c9952a',
      delivered: '#1a7c4a',
      cancelled: '#e7222e',
    };
    return map[status] || '#8a94a6';
  }
}
