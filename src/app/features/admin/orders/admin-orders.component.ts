import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
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
  imports: [CommonModule, PageHeaderComponent, StatusBadgeComponent, DatePipe],
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
  isLoading = signal(true);

  // Data
  private orders$ = this.firestore.getCollection<Order>(
    'orders',
    where('tenantId', '==', 1)
  );
  private allOrders = toSignal(this.orders$, { initialValue: [] });

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
    const orders = this.allOrders();

    return orders
      .filter(o => !o.isDeleted)
      .filter(o => {
        const matchesSearch = !query || 
          o.orderNumber.toLowerCase().includes(query) || 
          o.customerName.toLowerCase().includes(query);
        
        const matchesStatus = status === 'all' || o.status === status;
        const matchesPayment = payment === 'all' || o.paymentStatus === payment;
        
        let matchesDate = true;
        if (date !== 'all') {
          const now = new Date();
          const orderDate = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
          const diffDays = (now.getTime() - orderDate.getTime()) / (1000 * 3600 * 24);
          
          if (date === 'today') matchesDate = diffDays < 1;
          else if (date === 'last_7') matchesDate = diffDays <= 7;
          else if (date === 'last_30') matchesDate = diffDays <= 30;
        }

        return matchesSearch && matchesStatus && matchesPayment && matchesDate;
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
