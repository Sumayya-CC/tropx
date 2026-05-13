import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { StockAdjustment, ADJUSTMENT_TYPE_LABELS } from '../../../core/models/stock-adjustment.model';
import { where } from '@angular/fire/firestore';
import { TENANT_ID } from '../../../core/config/tenant.config';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { StockAdjustmentModalComponent } from './stock-adjustment-modal/stock-adjustment-modal.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';

@Component({
  selector: 'app-admin-stock-adjustments',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    LoadingSpinnerComponent, 
    StatusBadgeComponent, 
    StockAdjustmentModalComponent,
    PageHeaderComponent
  ],
  templateUrl: './admin-stock-adjustments.component.html',
  styleUrl: './admin-stock-adjustments.component.scss'
})
export class AdminStockAdjustmentsComponent {
  private readonly firestore = inject(FirestoreService);

  // State
  adjustments = signal<StockAdjustment[]>([]);
  isLoading = signal(true);
  isModalOpen = signal(false);
  selectedAdjustment = signal<StockAdjustment | null>(null);

  // Filters
  searchQuery = signal('');
  typeFilter = signal<string>('all');
  dateRangeFilter = signal<string>('all');

  // Constants
  adjustmentTypes = [
    { value: 'all', label: 'All Types' },
    ...Object.entries(ADJUSTMENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))
  ];

  dateRanges = [
    { value: 'today', label: 'Today' },
    { value: '7days', label: 'Last 7 Days' },
    { value: '30days', label: 'Last 30 Days' },
    { value: 'all', label: 'All Time' }
  ];

  // Computed
  filteredAdjustments = computed(() => {
    let list = this.adjustments();

    // In-memory filter isDeleted (per requirements)
    list = list.filter(a => !a.isDeleted);

    // Search
    const search = this.searchQuery().trim().toLowerCase();
    if (search) {
      list = list.filter(a => 
        a.productName.toLowerCase().includes(search) || 
        a.productSku.toLowerCase().includes(search) ||
        a.reason.toLowerCase().includes(search)
      );
    }

    // Type Filter
    if (this.typeFilter() !== 'all') {
      list = list.filter(a => a.type === this.typeFilter());
    }

    // Date Filter
    const now = new Date();
    if (this.dateRangeFilter() === 'today') {
      const start = new Date(now.setHours(0, 0, 0, 0));
      list = list.filter(a => this.toDate(a.createdAt) >= start);
    } else if (this.dateRangeFilter() === '7days') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      list = list.filter(a => this.toDate(a.createdAt) >= start);
    } else if (this.dateRangeFilter() === '30days') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      list = list.filter(a => this.toDate(a.createdAt) >= start);
    }

    // In-memory sort (per requirements)
    return [...list].sort((a, b) => this.toDate(b.createdAt).getTime() - this.toDate(a.createdAt).getTime());
  });

  stats = computed(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Using adjustments() here to get stats for the current month regardless of current filters
    const currentMonth = this.adjustments().filter(a => !a.isDeleted && this.toDate(a.createdAt) >= monthStart);

    const total = currentMonth.length;
    const received = currentMonth.reduce((sum, a) => sum + (a.quantity > 0 ? a.quantity : 0), 0);
    const removed = Math.abs(currentMonth.reduce((sum, a) => sum + (a.quantity < 0 ? a.quantity : 0), 0));
    const damaged = currentMonth.reduce((sum, a) => sum + (a.type === 'damaged' ? Math.abs(a.quantity) : 0), 0);

    return { total, received, removed, damaged };
  });

  constructor() {
    this.loadAdjustments();
  }

  loadAdjustments() {
    this.isLoading.set(true);
    this.firestore.getCollection<StockAdjustment>('stockAdjustments', 
      where('tenantId', '==', TENANT_ID)
    ).subscribe({
      next: (data: StockAdjustment[]) => {
        const active = data.filter(a => a.isDeleted !== true);
        const sorted = active.sort((a, b) => {
          const aTime = (a.createdAt as any)?.seconds ?? 0;
          const bTime = (b.createdAt as any)?.seconds ?? 0;
          return bTime - aTime;
        });
        this.adjustments.set(sorted);
        this.isLoading.set(false);
      },
      error: (err: any) => {
        console.error('Error loading adjustments', err);
        this.isLoading.set(false);
      }
    });
  }

  formatDate(createdAt: any): string {
    if (!createdAt) return '—';
    const date = createdAt.toDate ? createdAt.toDate() : 
                 new Date(createdAt);
    return date.toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  openNewModal() {
    this.selectedAdjustment.set(null);
    this.isModalOpen.set(true);
  }

  openDetailModal(adj: StockAdjustment) {
    this.selectedAdjustment.set(adj);
    this.isModalOpen.set(true);
  }

  closeModal(refresh: boolean) {
    this.isModalOpen.set(false);
    this.selectedAdjustment.set(null);
    if (refresh) {
      this.loadAdjustments();
    }
  }

  private toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts.toDate) return ts.toDate();
    return new Date(ts);
  }
}
