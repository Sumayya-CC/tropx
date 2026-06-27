import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { PurchaseOrder, PO_STATUS_LABELS } from '../../../core/models/purchase-order.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';

@Component({
  selector: 'app-admin-purchase-orders',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PageHeaderComponent, LoadingSpinnerComponent, StatusBadgeComponent],
  template: `
    <app-page-header 
      title="Purchase Orders" 
      subtitle="Manage your inbound orders"
      buttonLabel="New Purchase Order"
      (buttonClick)="router.navigate(['/admin/purchase-orders/new'])">
    </app-page-header>

    <div class="filters-card">
      <div class="search-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)" placeholder="Search PO number or supplier...">
      </div>
      
      <div class="filter-group">
        <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="partially_received">Partially Received</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select [ngModel]="dateFilter()" (ngModelChange)="dateFilter.set($event)">
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="last_7">Last 7 Days</option>
          <option value="last_30">Last 30 Days</option>
        </select>
      </div>
    </div>

    <div class="table-card">
      @if (isLoading()) {
        <app-loading-spinner></app-loading-spinner>
      } @else if (filteredOrders().length === 0) {
        <div class="empty-state">
          <div class="empty-icon"></div>
          <h3>No purchase orders found</h3>
          <p>Create a new purchase order to get started.</p>
          <button class="btn-add" routerLink="/admin/purchase-orders/new">New PO</button>
        </div>
      } @else {
        <table class="data-table">
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Supplier</th>
              <th>Date</th>
              <th>Status</th>
              <th>Items</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            @for (po of filteredOrders(); track po.id) {
              <tr class="clickable-row" [routerLink]="['/admin/purchase-orders', po.id]">
                <td class="fw-bold">{{ po.poNumber }}</td>
                <td>{{ po.supplierName }}</td>
                <td>{{ formatDate(po.orderDate) }}</td>
                <td>
                  <app-status-badge [status]="getBadgeStatus(po.status)" [label]="getStatusLabel(po.status)"></app-status-badge>
                </td>
                <td>{{ po.items.length }}</td>
                <td class="fw-bold">{{ formatCurrency(po.totalCents) }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: [`
    .filters-card {
      background: #fff;
      padding: 16px;
      border-radius: 12px;
      margin-bottom: 24px;
      display: flex;
      gap: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);

      .search-box {
        flex: 1;
        position: relative;
        .search-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #9ca3af;
        }
        input {
          width: 100%;
          padding: 10px 10px 10px 40px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 0.95rem;
          &:focus { outline: none; border-color: #0f172a; }
        }
      }

      .filter-group {
        display: flex;
        gap: 12px;
        select {
          padding: 10px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #f9fafb;
          font-size: 0.9rem;
          cursor: pointer;
          &:focus { outline: none; border-color: #0f172a; }
        }
      }
    }

    .table-card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;

      th, td {
        padding: 16px;
        text-align: left;
        border-bottom: 1px solid #f3f4f6;
      }

      th {
        background: #f8fafc;
        color: #64748b;
        font-weight: 600;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .clickable-row {
        cursor: pointer;
        transition: background 0.15s;
        &:hover { background: #f8fafc; }
      }

      .fw-bold { font-weight: 600; }
    }

    .empty-state {
      padding: 60px 20px;
      text-align: center;
      h3 { margin-bottom: 8px; color: #0f172a; }
      p { margin-bottom: 24px; color: #64748b; }
      .btn-add {
        background: #0f172a;
        color: #fff;
        border: none;
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
      }
    }
  `]
})
export class AdminPurchaseOrdersComponent {
  private readonly firestore = inject(FirestoreService);
  protected readonly router = inject(Router);

  searchQuery = signal('');
  statusFilter = signal<string>('all');
  dateFilter = signal<string>('last_30');

  private pos$ = this.firestore.getCollection<PurchaseOrder>(
    'purchaseOrders',
    where('tenantId', '==', 1)
  );

  allOrders = toSignal(this.pos$, { initialValue: [] as PurchaseOrder[] });
  
  isLoading = computed(() => this.allOrders().length === 0 && !this.hasLoaded);
  private hasLoaded = false;

  constructor() {
    this.pos$.subscribe(() => this.hasLoaded = true);
  }

  filteredOrders = computed(() => {
    let list = this.allOrders().filter(o => !o.isDeleted);

    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(o => 
        o.poNumber.toLowerCase().includes(q) ||
        o.supplierName.toLowerCase().includes(q)
      );
    }

    const s = this.statusFilter();
    if (s !== 'all') {
      list = list.filter(o => o.status === s);
    }

    const dFilter = this.dateFilter();
    const todayStr = new Date().toISOString().split('T')[0];
    
    if (dFilter === 'today') {
      list = list.filter(o => this.getDateStr(o.orderDate) === todayStr);
    } else if (dFilter === 'last_7' || dFilter === 'last_30') {
      const d = new Date();
      d.setDate(d.getDate() - (dFilter === 'last_7' ? 7 : 30));
      const threshold = d.toISOString().split('T')[0];
      list = list.filter(o => this.getDateStr(o.orderDate) >= threshold);
    }

    return list.sort((a, b) => this.getDateStr(b.createdAt).localeCompare(this.getDateStr(a.createdAt)));
  });

  private getDateStr(ts: any): string {
    if (!ts) return '';
    let d: Date;
    if (ts.toDate) d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    else d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  }

  formatDate(ts: any): string {
    if (!ts) return '—';
    let d: Date;
    if (ts.toDate) d = ts.toDate();
    else d = new Date(ts);
    return new DatePipe('en-US').transform(d, 'MMM d, yyyy') || '—';
  }

  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  getStatusLabel(status: string): string {
    return PO_STATUS_LABELS[status as keyof typeof PO_STATUS_LABELS] || status;
  }

  getBadgeStatus(status: string): 'info' | 'success' | 'warning' | 'danger' | 'inactive' {
    switch (status) {
      case 'draft': return 'info';
      case 'sent': return 'warning';
      case 'partially_received': return 'warning';
      case 'received': return 'success';
      case 'cancelled': return 'danger';
      default: return 'inactive';
    }
  }
}
