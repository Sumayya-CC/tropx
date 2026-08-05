import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-closure-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './closure-card.component.html',
})
export class ClosureCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingClosure = signal(false);
  isSaving = signal(false);

  closureActive = signal(false);
  closureMessage = signal('');

  constructor() {
    effect(() => {
      const ord = this.settings.ordering();
      this.closureActive.set(ord.closureActive ?? false);
      this.closureMessage.set(ord.closureMessage || '');
    }, { allowSignalWrites: true });
  }

  cancelClosure() {
    const ord = this.settings.ordering();
    this.closureActive.set(
      ord.closureActive ?? false);
    this.closureMessage.set(
      ord.closureMessage || '');
    this.editingClosure.set(false);
  }

  async saveClosure() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        closureActive: this.closureActive(),
        closureMessage:
          this.closureMessage() || null,
      });
      this.toast.success(
        'Closure settings saved');
      this.editingClosure.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save closure settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
