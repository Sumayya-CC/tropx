import { Component, inject, signal, effect, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { centsToDisplay } from '../../../../shared/utils/currency.utils';
import { Customer } from '../../../../core/models/customer.model';
import { Order } from '../../../../core/models/order.model';
import { Payment, PaymentMethod, PAYMENT_METHOD_LABELS } from '../../../../core/models/payment.model';
import { Return } from '../../../../core/models/return.model';
import { where, orderBy, limit, serverTimestamp } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';

interface ServiceArea {
  id: string;
  name: string;
  tenantId: number;
  isDeleted: boolean;
}

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, LoadingSpinnerComponent, DatePipe],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.scss'
})
export class CustomerDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  customer = signal<Customer | null>(null);
  serviceAreaName = signal<string>('Loading...');
  recentOrders = signal<Order[]>([]);
  isLoading = signal(true);

  private customerId = this.route.snapshot.paramMap.get('id') || '';

  private payments$ = this.firestore.getCollection<Payment>(
    'payments',
    where('customerId', '==', this.customerId),
    where('tenantId', '==', 1)
  );
  customerPayments = toSignal(this.payments$, { initialValue: [] as Payment[] });

  recentPayments = computed(() =>
    this.customerPayments()
      .filter(p => !p.isDeleted)
      .sort((a, b) => (b.receivedDate || '').localeCompare(a.receivedDate || ''))
      .slice(0, 10)
  );

  private returns$ = this.firestore.getCollection<Return>(
    'returns',
    where('customerId', '==', this.customerId),
    where('tenantId', '==', 1)
  );
  customerReturns = toSignal(this.returns$, { initialValue: [] as Return[] });

  recentReturns = computed(() =>
    this.customerReturns()
      .filter(r => !r.isDeleted && r.status === 'approved')
      .sort((a, b) => {
        const aTime = a.createdAt?.seconds ?? 0;
        const bTime = b.createdAt?.seconds ?? 0;
        return bTime - aTime;
      })
      .slice(0, 5)
  );

  constructor() {
    effect(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.loadCustomer(id);
        this.loadRecentOrders(id);
      }
    });
  }

  private loadCustomer(id: string) {
    this.firestore.getDocument<Customer>(`customers/${id}`).subscribe({
      next: (data: Customer | null) => {
        if (!data || data.isDeleted) {
          this.toast.error('Customer not found');
          this.router.navigate(['/admin/customers']);
          return;
        }
        this.customer.set(data);
        this.resolveServiceArea(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load customer', err);
        this.toast.error('Failed to load customer');
        this.router.navigate(['/admin/customers']);
      }
    });
  }

  private resolveServiceArea(customer: Customer) {
    if (customer.serviceAreaCustom) {
      this.serviceAreaName.set(customer.serviceAreaCustom);
      return;
    }
    if (customer.serviceAreaId) {
      this.firestore.getDocument<ServiceArea>(`serviceAreas/${customer.serviceAreaId}`).subscribe({
        next: (sa) => {
          this.serviceAreaName.set(sa ? sa.name : 'Unknown');
        },
        error: () => this.serviceAreaName.set('Unknown')
      });
    } else {
      this.serviceAreaName.set('None');
    }
  }

  private loadRecentOrders(customerId: string) {
    this.firestore.getCollection<Order>(
      'orders',
      where('customerId', '==', customerId),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc'),
      limit(5)
    ).subscribe({
      next: (orders) => this.recentOrders.set(orders),
      error: (err) => console.error('Failed to load orders', err)
    });
  }

  getInitials(name: string): string {
    return name.substring(0, 2).toUpperCase();
  }

  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  getSourceLabel(source: string): string {
    if (source === 'admin_created') return 'Added by staff';
    if (source === 'access_request') return 'Self-registered';
    return source;
  }

  getMethodLabel(method: string): string {
    return PAYMENT_METHOD_LABELS[method as PaymentMethod] || method;
  }

  formatDate(value: any): string {
    if (!value) return '—';
    const date = value?.toDate ? value.toDate() : 
                 value instanceof Date ? value : 
                 new Date(value);
    return new Intl.DateTimeFormat('en-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  async deleteCustomer() {
    const cust = this.customer();
    if (!cust) return;
    
    if (!confirm(`Are you sure you want to delete ${cust.businessName}?`)) {
      return;
    }

    try {
      await this.firestore.updateDocument(`customers/${cust.id}`, {
        isDeleted: true,
        isDeletedAt: serverTimestamp(),
        deletedBy: this.auth.getActionBy()
      });
      this.toast.success('Customer deleted successfully');
      this.router.navigate(['/admin/customers']);
    } catch (e) {
      console.error('Delete failed', e);
      this.toast.error('Failed to delete customer');
    }
  }

  copyId() {
    const cust = this.customer();
    if (!cust) return;
    navigator.clipboard.writeText(cust.id);
    this.toast.success('Customer ID copied!');
  }
}
