import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-reconciliation-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reconciliation-card.component.html',
  styleUrl: './reconciliation-card.component.scss',
})
export class ReconciliationCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingReconciliation = signal(false);
  isSaving = signal(false);

  reconNotifyThresholdDollars = signal(1);
  reconAutoCorrectMaxDollars = signal(50);
  reconAutoCorrectEnabled = signal(true);
  reconNotifyAdmin = signal(true);

  constructor() {
    effect(() => {
      const r = this.settings.reconciliation();
      this.reconNotifyThresholdDollars.set(r.notifyThresholdCents / 100);
      this.reconAutoCorrectMaxDollars.set(r.autoCorrectMaxCents / 100);
      this.reconAutoCorrectEnabled.set(r.autoCorrectEnabled);
      this.reconNotifyAdmin.set(r.notifyAdmin);
    }, { allowSignalWrites: true });
  }

  cancelReconciliation() {
    const r = this.settings.reconciliation();
    this.reconNotifyThresholdDollars.set(r.notifyThresholdCents / 100);
    this.reconAutoCorrectMaxDollars.set(r.autoCorrectMaxCents / 100);
    this.reconAutoCorrectEnabled.set(r.autoCorrectEnabled);
    this.reconNotifyAdmin.set(r.notifyAdmin);
    this.editingReconciliation.set(false);
  }

  async saveReconciliation() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/reconciliation', {
        notifyThresholdCents: Math.round(this.reconNotifyThresholdDollars() * 100),
        autoCorrectMaxCents: Math.round(this.reconAutoCorrectMaxDollars() * 100),
        autoCorrectEnabled: this.reconAutoCorrectEnabled(),
        notifyAdmin: this.reconNotifyAdmin(),
        tenantId: 1,
      });
      this.toast.success('Reconciliation settings saved');
      this.editingReconciliation.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save reconciliation settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
