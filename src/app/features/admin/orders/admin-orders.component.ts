import { Component, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { Order, OrderStatus, PaymentStatus, ORDER_STATUS_LABELS } from '../../../core/models/order.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { centsToDisplay } from '../../../shared/utils/currency.utils';

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, StatusBadgeComponent, DatePipe, FormsModule],
  templateUrl: './admin-orders.component.html',
  styleUrls: ['./admin-orders.component.scss']
})
export class AdminOrdersComponent {
  private readonly firestore = inject(FirestoreService);
  protected readonly router = inject(Router);

  // State
  searchQuery = signal('');
  statusFilter = signal<OrderStatus | 'all'>('all');
  dateFilter = signal<'today' | 'last_7' | 'last_30' | 'all'>('all');
  paymentFilter = signal<PaymentStatus | 'all'>('all');
  selectedServiceAreas = signal<string[]>([]);
  showAreaFilter = signal(false);
  isLoading = signal(true);
  sourceFilter = signal<'all' | 'admin_created' | 'customer_portal'>('all');

  // Data
  private orders$ = this.firestore.getCollection<Order>(
    'orders',
    where('tenantId', '==', 1)
  );
  private allOrders = toSignal(this.orders$, { initialValue: [] });

  private serviceAreas$ = this.firestore.getCollection<any>(
    'serviceAreas',
    where('tenantId', '==', 1),
    where('isDeleted', '==', false)
  );
  serviceAreas = toSignal(this.serviceAreas$, { initialValue: [] });

  constructor() {
    // Basic loading state handling
    this.orders$.subscribe(() => this.isLoading.set(false));
  }

  // Computed
  filteredOrders = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const status = this.statusFilter();
    const date = this.dateFilter();
    const payment = this.paymentFilter();
    const areas = this.selectedServiceAreas();
    const orders = this.allOrders();

    return orders
      .filter(o => !o.isDeleted)
      .filter(o => {
        const matchesSearch = !query || 
          o.orderNumber.toLowerCase().includes(query) || 
          o.customerName.toLowerCase().includes(query);
        
        const matchesStatus = status === 'all' || o.status === status;
        const matchesPayment = payment === 'all' || o.paymentStatus === payment;
        const matchesArea = areas.length === 0 ||
          (o.serviceAreaName && areas.includes(o.serviceAreaName));
        
        const matchesSource =
          this.sourceFilter() === 'all' ||
          o.source === this.sourceFilter();

        let matchesDate = true;
        if (date !== 'all') {
          const now = new Date();
          const orderDate = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
          const diffDays = (now.getTime() - orderDate.getTime()) / (1000 * 3600 * 24);
          
          if (date === 'today') matchesDate = diffDays < 1;
          else if (date === 'last_7') matchesDate = diffDays <= 7;
          else if (date === 'last_30') matchesDate = diffDays <= 30;
        }

        return matchesSearch && matchesStatus && matchesPayment && matchesDate && matchesArea && matchesSource;
      })
      .sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
        return dateB - dateA;
      });
  });

  stats = computed(() => {
    const orders = this.allOrders().filter(o => !o.isDeleted);
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthOrders = orders.filter(o => {
      const orderDate = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
      return orderDate.getMonth() === currentMonth && orderDate.getFullYear() === currentYear;
    });

    return {
      totalOrdersMonth: monthOrders.length,
      confirmedCount: orders.filter(o => o.status === 'confirmed').length,
      outForDeliveryCount: orders.filter(o => o.status === 'out_for_delivery').length,
      revenueMonthCents: monthOrders.reduce((sum, o) => sum + o.totalCents, 0)
    };
  });

  // Export Modal State
  showExportModal = signal(false);
  exportFromDate = signal('');
  exportToDate = signal('');
  exportIncludeCancelled = signal(true);
  exportSourceFilter = signal<'all' | 'admin_created' | 'customer_portal'>('all');

  exportPreviewCount = computed(() => {
    let list = [...this.filteredOrders()];

    if (this.exportFromDate()) {
      const from = new Date(
        this.exportFromDate() + 'T00:00:00'
      );
      list = list.filter(o => {
        const d = o.confirmedAt?.toDate
          ? o.confirmedAt.toDate()
          : new Date(o.confirmedAt);
        return d >= from;
      });
    }
    if (this.exportToDate()) {
      const to = new Date(
        this.exportToDate() + 'T23:59:59'
      );
      list = list.filter(o => {
        const d = o.confirmedAt?.toDate
          ? o.confirmedAt.toDate()
          : new Date(o.confirmedAt);
        return d <= to;
      });
    }
    if (!this.exportIncludeCancelled()) {
      list = list.filter(
        o => o.status !== 'cancelled'
      );
    }
    if (this.exportSourceFilter() !== 'all') {
      list = list.filter(
        o => o.source === this.exportSourceFilter()
      );
    }
    return list.length;
  });

  exportOrders() {
    let list = [...this.filteredOrders()];

    if (this.exportFromDate()) {
      const from = new Date(
        this.exportFromDate() + 'T00:00:00'
      );
      list = list.filter(o => {
        const d = o.confirmedAt?.toDate
          ? o.confirmedAt.toDate()
          : new Date(o.confirmedAt);
        return d >= from;
      });
    }
    if (this.exportToDate()) {
      const to = new Date(
        this.exportToDate() + 'T23:59:59'
      );
      list = list.filter(o => {
        const d = o.confirmedAt?.toDate
          ? o.confirmedAt.toDate()
          : new Date(o.confirmedAt);
        return d <= to;
      });
    }
    if (!this.exportIncludeCancelled()) {
      list = list.filter(
        o => o.status !== 'cancelled'
      );
    }
    if (this.exportSourceFilter() !== 'all') {
      list = list.filter(
        o => o.source === this.exportSourceFilter()
      );
    }

    const headers = [
      'Order #',
      'Source',
      'Customer',
      'Customer Email',
      'Service Area',
      'Order Date',
      'Fiscal Year',
      'Fiscal Quarter',
      'Items Count',
      'Subtotal',
      'Discount',
      'Tax Rate %',
      'Tax Amount',
      'Total',
      'Amount Paid',
      'Balance Due',
      'Payment Status',
      'Order Status',
      'Delivery Type',
      'Confirmed Date',
      'Out for Delivery Date',
      'Delivered Date',
      'Cancelled Date',
      'Days Outstanding',
      'Overdue',
    ];

    const overdueAfterDays = 30;
    const now = new Date();

    const rows = list.map(o => {
      const confirmedDate = o.confirmedAt?.toDate
        ? o.confirmedAt.toDate()
        : o.confirmedAt
          ? new Date(o.confirmedAt) : null;

      const daysOutstanding =
        confirmedDate &&
        o.status !== 'cancelled' &&
        o.paymentStatus !== 'paid'
        ? Math.floor(
            (now.getTime() -
             confirmedDate.getTime()) / 86400000
          )
        : 0;

      const isOverdue =
        daysOutstanding > overdueAfterDays
          ? 'Yes' : 'No';

      const sourceLabel =
        o.source === 'customer_portal'
          ? 'Customer Portal'
          : 'Admin Created';

      const getFiscalYear = (ts: any) => {
        if (!ts) return '';
        const d = ts.toDate
          ? ts.toDate() : new Date(ts);
        return String(d.getFullYear());
      };

      const getFiscalQuarter = (ts: any) => {
        if (!ts) return '';
        const d = ts.toDate
          ? ts.toDate() : new Date(ts);
        const q = Math.ceil(
          (d.getMonth() + 1) / 3
        );
        return `Q${q} ${d.getFullYear()}`;
      };

      const formatDateForCsv = (ts: any) => {
        if (!ts) return '';
        const d = ts.toDate
          ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('en-CA', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
      };

      return [
        o.orderNumber,
        sourceLabel,
        o.customerName,
        o.customerEmail || '',
        o.serviceAreaName || '',
        formatDateForCsv(o.confirmedAt),
        getFiscalYear(o.confirmedAt),
        getFiscalQuarter(o.confirmedAt),
        o.items?.length || 0,
        (o.subtotalCents / 100).toFixed(2),
        (o.discountCents / 100).toFixed(2),
        o.taxRatePercent,
        (o.taxCents / 100).toFixed(2),
        (o.totalCents / 100).toFixed(2),
        (o.amountPaidCents / 100).toFixed(2),
        (o.balanceCents / 100).toFixed(2),
        o.paymentStatus,
        o.status,
        o.deliveryType,
        formatDateForCsv(o.confirmedAt),
        formatDateForCsv(o.outForDeliveryAt),
        formatDateForCsv(o.deliveredAt),
        formatDateForCsv(o.cancelledAt),
        daysOutstanding,
        isOverdue,
      ];
    });

    const csvContent = this.generateCsvContent(
      headers, rows
    );

    const dateTag = this.exportFromDate() &&
      this.exportToDate()
      ? `_${this.exportFromDate()}_to_` +
        `${this.exportToDate()}`
      : '';

    this.downloadCsv(
      `orders${dateTag}_export.csv`,
      csvContent
    );
    this.showExportModal.set(false);
  }

  private generateCsvContent(headers: string[], rows: any[][]): string {
    const csvRows = [
      headers.map(h => this.escapeCsv(h)).join(','),
      ...rows.map(row => row.map(cell => this.escapeCsv(cell)).join(','))
    ];
    return csvRows.join('\r\n');
  }

  private escapeCsv(val: any): string {
    if (val === null || val === undefined) return '';
    let str = String(val);
    str = str.replace(/"/g, '""');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str}"`;
    }
    return str;
  }

  private formatDate(ts: any): string {
    if (!ts) return '';
    let date: Date;
    if (ts.toDate) {
      date = ts.toDate();
    } else if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else {
      date = new Date(ts);
    }
    if (isNaN(date.getTime())) return '';
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }

  private downloadCsv(filename: string, csvContent: string) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  // Handlers
  onSearchChange(event: Event) {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  onStatusFilterChange(event: Event) {
    this.statusFilter.set((event.target as HTMLSelectElement).value as any);
  }

  onDateFilterChange(event: Event) {
    this.dateFilter.set((event.target as HTMLSelectElement).value as any);
  }

  onPaymentFilterChange(event: Event) {
    this.paymentFilter.set((event.target as HTMLSelectElement).value as any);
  }

  toggleAreaFilter() {
    this.showAreaFilter.update(v => !v);
  }

  toggleServiceArea(areaName: string) {
    this.selectedServiceAreas.update(current => {
      if (current.includes(areaName)) {
        return current.filter(a => a !== areaName);
      }
      return [...current, areaName];
    });
  }

  isAreaSelected(areaName: string): boolean {
    return this.selectedServiceAreas().includes(areaName);
  }

  clearAreaFilter() {
    this.selectedServiceAreas.set([]);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.area-filter')) {
      this.showAreaFilter.set(false);
    }
  }

  navigateToNewOrder() {
    this.router.navigate(['/admin/orders/new']);
  }

  viewOrder(id: string) {
    this.router.navigate(['/admin/orders', id]);
  }

  // Utils
  formatCurrency(cents: number) {
    return centsToDisplay(cents);
  }

  getStatusLabel(status: OrderStatus): string {
    return ORDER_STATUS_LABELS[status];
  }

  getOrderStatusColor(status: OrderStatus): string {
    switch (status) {
      case 'confirmed': return 'info';
      case 'out_for_delivery': return 'warning';
      case 'delivered': return 'success';
      case 'cancelled': return 'danger';
      default: return 'info';
    }
  }

  getPaymentStatusColor(status: PaymentStatus): string {
    switch (status) {
      case 'unpaid': return 'danger';
      case 'partial': return 'warning';
      case 'paid': return 'success';
      default: return 'info';
    }
  }
}
