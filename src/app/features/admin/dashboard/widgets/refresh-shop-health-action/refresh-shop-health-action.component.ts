import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Functions, httpsCallable } from '@angular/fire/functions';

import { ToastService } from '../../../../../shared/services/toast.service';

@Component({
  selector: 'app-refresh-shop-health-action',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './refresh-shop-health-action.component.html',
  styleUrl: './refresh-shop-health-action.component.scss',
})
export class RefreshShopHealthActionComponent {
  private readonly functions2 = inject(Functions);
  private readonly toast = inject(ToastService);

  isRefreshingHealth = signal(false);

  async refreshShopHealth() {
    this.isRefreshingHealth.set(true);
    try {
      const fn = httpsCallable(this.functions2, 'refreshShopHealthNow'); // northeast2 instance
      const res: any = await fn({});
      this.toast.success(`Health refreshed: ${res.data?.updated ?? 0} shops`);
    } catch (e) {
      console.error(e);
      this.toast.error('Refresh failed');
    } finally {
      this.isRefreshingHealth.set(false);
    }
  }
}
