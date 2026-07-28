import { Component, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { OwnerFullNamePipe } from '../../../shared/pipes/full-name.pipe';
import { where, orderBy } from '@angular/fire/firestore';
import { Shop, ShopStatus } from '../../../core/models/shop.model';
import { LogVisitComponent } from './log-visit/log-visit.component';
import { SettingsService } from '../../../core/services/settings.service';
import { HEALTH_BAND_LABELS, HEALTH_BAND_TONE, HealthBand } from '../../../shared/utils/shop-health.utils';

@Component({
  selector: 'app-admin-shops',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StatusBadgeComponent, OwnerFullNamePipe, LogVisitComponent],
  templateUrl: './admin-shops.component.html',
  styleUrl: './admin-shops.component.scss'
})
export class AdminShopsComponent {
  private readonly firestore = inject(FirestoreService);
  protected readonly router = inject(Router);

  shops = signal<Shop[]>([]);
  isLoading = signal(true);
  searchQuery = signal('');
  statusFilter = signal<ShopStatus | 'all'>('all');
  logVisitShop = signal<Shop | null>(null);

  protected readonly settings = inject(SettingsService);

  filteredShops = computed(() => {
    let result = this.shops();
    const q = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    if (q) {
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.ownerFirstName || '').toLowerCase().includes(q) ||
        (s.ownerLastName || '').toLowerCase().includes(q) ||
        (s.managerFirstName || '').toLowerCase().includes(q) ||
        (s.managerLastName || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q) ||
        (s.address?.city || '').toLowerCase().includes(q)
      );
    }
    if (status !== 'all') result = result.filter(s => s.status === status);
    return result;
  });

  stats = computed(() => {
    const all = this.shops();
    return {
      total: all.length,
      prospects: all.filter(s => s.status === 'prospect').length,
      customers: all.filter(s => s.status === 'customer').length,
      dormant: all.filter(s => s.status === 'dormant').length,
    };
  });

  constructor() { 
    this.loadShops();
  }

  private loadShops() {
    this.firestore.getCollection<Shop>(
      'shops',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false),
      orderBy('name')
    ).pipe(takeUntilDestroyed()).subscribe({
      next: (data) => { this.shops.set(data); this.isLoading.set(false); },
      error: (err) => { console.error('Error loading shops:', err); this.isLoading.set(false); }
    });
  }

  getInitials(name: string): string { return name ? name.substring(0, 2).toUpperCase() : '??'; }
  goToDetails(id: string) { this.router.navigate(['/admin/shops', id]); }
  openLogVisit(shop: Shop, ev: Event) { ev.stopPropagation(); this.logVisitShop.set(shop); }

  bandOf(shop: Shop): { label: string; tone: string; days: number | null; known: boolean } {
    const band = (shop.healthBand || 'unknown') as HealthBand;
    return {
      label: HEALTH_BAND_LABELS[band],
      tone: HEALTH_BAND_TONE[band],
      days: shop.healthDays ?? null,
      known: band !== 'unknown',
    };
  }
}
