import { Component, computed, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { Coupon } from '../../../core/models/coupon.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { centsToDisplay } from '../../../shared/utils/currency.utils';

@Component({
  selector: 'app-admin-coupons',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent, HasPermissionDirective],
  templateUrl: './admin-coupons.component.html',
  styleUrl: './admin-coupons.component.scss'
})
export class AdminCouponsComponent implements OnInit {
  private readonly firestore = inject(FirestoreService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly router = inject(Router);

  coupons = signal<Coupon[]>([]);
  isLoading = signal(true);

  searchQuery = signal('');
  statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  ngOnInit() {
    this.isLoading.set(true);
    this.firestore.getCollection<Coupon>(
      'coupons',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.coupons.set([...data].sort((a, b) => (a.code || '').localeCompare(b.code || '')));
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load coupons:', err);
        this.isLoading.set(false);
      }
    });
  }

  filteredCoupons = computed(() => {
    let result = this.coupons();
    const query = this.searchQuery().trim().toLowerCase();
    if (query) {
      result = result.filter(c =>
        c.code.toLowerCase().includes(query) ||
        (c.description || '').toLowerCase().includes(query)
      );
    }
    const status = this.statusFilter();
    if (status !== 'all') {
      result = result.filter(c => c.active === (status === 'active'));
    }
    return result;
  });

  valueLabel(coupon: Coupon): string {
    return coupon.type === 'percentage' ?
      `${coupon.value}% off` :
      `${centsToDisplay(coupon.value)} off`;
  }

  usageLabel(coupon: Coupon): string {
    const used = coupon.usedCount || 0;
    return coupon.maxUsesTotal != null ? `${used} / ${coupon.maxUsesTotal}` : `${used}`;
  }

  validityLabel(coupon: Coupon): string {
    const starts = this.toDate(coupon.startsAt);
    const expires = this.toDate(coupon.expiresAt);
    if (!starts && !expires) return 'No expiry';
    const fmt = (d: Date) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    if (starts && expires) return `${fmt(starts)} – ${fmt(expires)}`;
    if (expires) return `Until ${fmt(expires)}`;
    return `From ${fmt(starts!)}`;
  }

  private toDate(ts: any): Date | null {
    if (!ts) return null;
    return ts.toDate ? ts.toDate() : new Date(ts);
  }

  async toggleActive(coupon: Coupon) {
    try {
      await this.firestore.updateDocument(`coupons/${coupon.id}`, { active: !coupon.active });
    } catch (e) {
      console.error('Failed to update coupon status', e);
    }
  }
}
