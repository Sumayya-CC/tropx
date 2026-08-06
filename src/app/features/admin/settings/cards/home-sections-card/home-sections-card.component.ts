import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-home-sections-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home-sections-card.component.html',
})
export class HomeSectionsCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingHomeSections = signal(false);
  isSaving = signal(false);

  orderAgainEnabled = signal(true);
  newArrivalsEnabled = signal(true);
  newArrivalsAutoDays = signal(14);
  popularEnabled = signal(true);

  constructor() {
    effect(() => {
      const sf = this.settings.storefront();
      this.orderAgainEnabled.set(sf.orderAgainEnabled);
      this.newArrivalsEnabled.set(sf.newArrivalsEnabled);
      this.newArrivalsAutoDays.set(sf.newArrivalsAutoDays ?? 14);
      this.popularEnabled.set(sf.popularEnabled);
    }, { allowSignalWrites: true });
  }

  cancelHomeSections() {
    const sf = this.settings.storefront();
    this.orderAgainEnabled.set(sf.orderAgainEnabled);
    this.newArrivalsEnabled.set(sf.newArrivalsEnabled);
    this.newArrivalsAutoDays.set(sf.newArrivalsAutoDays ?? 14);
    this.popularEnabled.set(sf.popularEnabled);
    this.editingHomeSections.set(false);
  }

  // Fixed S3: was setDocument(...spread) — a full-doc overwrite that raced
  // with Gallery/Popular/Featured Banner cards saving the same
  // settings/storefront doc concurrently. Now a scoped partial merge,
  // matching the other 3 cards on this doc.
  async saveHomeSections() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/storefront', {
        orderAgainEnabled: this.orderAgainEnabled(),
        newArrivalsEnabled: this.newArrivalsEnabled(),
        newArrivalsAutoDays: this.newArrivalsAutoDays(),
        popularEnabled: this.popularEnabled(),
      });
      this.toast.success('Home section settings saved');
      this.editingHomeSections.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save home section settings');
    } finally {
      this.isSaving.set(false);
    }
  }
}
