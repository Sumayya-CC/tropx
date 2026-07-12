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
import { take } from 'rxjs/operators';
import { FullNamePipe, OwnerFullNamePipe } from '../../../../shared/pipes/full-name.pipe';
import { ShopLinkService } from '../../../../core/services/shop-link.service';
import { EntityLinkModalComponent, LinkableItem } from '../../../../shared/components/entity-link-modal/entity-link-modal.component';
import { Shop, Visit } from '../../../../core/models/shop.model';
import { VisitService } from '../../../../core/services/visit.service';
import { CommonModule } from '@angular/common';

interface ServiceArea {
  id: string;
  name: string;
  tenantId: number;
  isDeleted: boolean;
}

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, LoadingSpinnerComponent, CommonModule, FullNamePipe, OwnerFullNamePipe, EntityLinkModalComponent],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.scss'
})
export class CustomerDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly shopLink = inject(ShopLinkService);
  private readonly visits = inject(VisitService);

  customer = signal<Customer | null>(null);
  serviceAreaName = signal<string>('Loading...');
  recentOrders = signal<Order[]>([]);
  recentVisits = signal<Visit[]>([]);
  isLoading = signal(true);
  isTogglingStatus = signal(false);

  linkedShop = signal<Shop | null>(null);
  showLinkModal = signal(false);
  linkItems = signal<LinkableItem[]>([]);
  linkSuggestedIds = signal<string[]>([]);
  linkBusy = signal(false);

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
        
        if (data.linkedShopId) {
          this.firestore.getDocument<Shop>(`shops/${data.linkedShopId}`).subscribe({
            next: (s) => this.linkedShop.set(s && !s.isDeleted ? s : null),
            error: () => this.linkedShop.set(null),
          });
          this.visits.listForShop(data.linkedShopId, 3)
            .then(v => this.recentVisits.set(v))
            .catch(() => this.recentVisits.set([]));
        } else {
          this.linkedShop.set(null);
          this.recentVisits.set([]);
        }

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
    if (customer.serviceAreaId) {
      this.firestore.getDocument<ServiceArea>(`serviceAreas/${customer.serviceAreaId}`).subscribe({
        next: (sa) => {
          this.serviceAreaName.set(sa ? sa.name : 'Unknown Area');
        },
        error: () => this.serviceAreaName.set('Unknown Area')
      });
    } else if (customer.serviceAreaCustom) {
      this.serviceAreaName.set(customer.serviceAreaCustom + ' (legacy)');
    } else {
      this.serviceAreaName.set('None');
    }
  }

  async openLinkShop() {
    const c = this.customer();
    if (!c) return;
    this.linkBusy.set(true);
    try {
      const [suggestions, browse] = await Promise.all([
        this.shopLink.findShopSuggestionsForCustomer(c),
        this.shopLink.listShopsWithoutCustomer(),
      ]);
      const suggestedIds = suggestions.map(s => s.id);
      const merged = [...suggestions, ...browse].filter(
        (s, i, arr) => arr.findIndex(x => x.id === s.id) === i
      );
      this.linkItems.set(merged.map(s => ({
        id: s.id,
        primaryText: s.name,
        secondaryText: [s.address?.city, s.phone].filter(Boolean).join(' · '),
      })));
      this.linkSuggestedIds.set(suggestedIds);
      this.showLinkModal.set(true);
    } catch (e) {
      console.error('Failed to load shops for linking', e);
      this.toast.error('Could not load shops');
    } finally {
      this.linkBusy.set(false);
    }
  }

  async onLinkShop(shopId: string) {
    const c = this.customer();
    if (!c) return;
    this.linkBusy.set(true);
    try {
      await this.shopLink.linkCustomerAndShop(c.id, shopId);
      this.toast.success('Customer linked to shop');
      this.showLinkModal.set(false);
      this.loadCustomer(c.id);
    } catch (e) {
      console.error('Link failed', e);
      this.toast.error('Failed to link');
    } finally {
      this.linkBusy.set(false);
    }
  }

  showUnlinkDialog = signal(false);
  unlinkNewStatus = signal<'prospect' | 'dormant' | 'not_interested'>('prospect');
  unlinkBusy = signal(false);

  openUnlink() {
    this.unlinkNewStatus.set('prospect');
    this.showUnlinkDialog.set(true);
  }

  async confirmUnlink() {
    const c = this.customer();
    const shopId = c?.linkedShopId;
    if (!c || !shopId) return;
    this.unlinkBusy.set(true);
    try {
      await this.shopLink.unlinkCustomerAndShop(c.id, shopId, this.unlinkNewStatus());
      this.toast.success('Unlinked. Shop status updated.');
      this.showUnlinkDialog.set(false);
      this.linkedShop.set(null);
      this.loadCustomer(c.id);
    } catch (e) {
      console.error('Unlink failed', e);
      this.toast.error('Failed to unlink');
    } finally {
      this.unlinkBusy.set(false);
    }
  }

  onAddNewShop() {
    const c = this.customer();
    if (!c) return;
    this.router.navigate(['/admin/shops/add'], { queryParams: { fromCustomer: c.id } });
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

  toDate(value: any): Date | null {
    if (!value) return null;
    return value?.toDate ? value.toDate() : 
           value instanceof Date ? value : 
           new Date(value);
  }

  visitDateOf(v: Visit): Date {
    const d: any = v.visitDate;
    return d?.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
  }

  async toggleSuspension() {
    const cust = this.customer();
    if (!cust) return;

    const isSuspending = cust.status !== 'suspended';
    const newStatus = isSuspending ? 'suspended' : 'active';

    const msg = isSuspending
      ? `Suspend ${cust.businessName}?\n\n` +
        `They will be blocked from logging in and placing ` +
        `orders. Their orders, balance, and history stay intact.`
      : `Reactivate ${cust.businessName}?\n\n` +
        `They will regain access to the portal.`;

    if (!confirm(msg)) return;

    this.isTogglingStatus.set(true);
    try {
      // 1. Flip the customer status (orders/debt untouched).
      await this.firestore.updateDocument(`customers/${cust.id}`, {
        status: newStatus,
      });

      // 2. Disable/enable the Firebase Auth account. Send email as
      //    the identifier — the Cloud Function resolves the uid
      //    server-side via getUserByEmail, since linkedUserId is not
      //    reliably populated. If no Auth account exists for the
      //    email, the function no-ops and the status flip alone
      //    blocks the customer.
      await this.firestore.addDocument('authActions', {
        action: isSuspending ? 'disable' : 'enable',
        email: cust.email,
        uid: cust.linkedUserId ?? null,
        triggeredBy: this.auth.getActionBy(),
        processed: false,
        tenantId: 1,
        createdAt: serverTimestamp(),
      });

      this.customer.set({ ...cust, status: newStatus });
      this.toast.success(
        isSuspending
          ? `${cust.businessName} suspended`
          : `${cust.businessName} reactivated`
      );
    } catch (e) {
      console.error('Failed to toggle suspension', e);
      this.toast.error(
        `Failed to ${isSuspending ? 'suspend' : 'reactivate'} customer`
      );
    } finally {
      this.isTogglingStatus.set(false);
    }
  }

  async deleteCustomer() {
    const cust = this.customer();
    if (!cust) return;

    // Guard: block deletion while the customer has any outstanding
    // balance. Compute from live order balances (source of truth),
    // not the denormalized totalOwingCents counter which can drift.
    let outstandingCents = 0;
    try {
      const orders = await this.firestore.getCollection<Order>(
        'orders',
        where('customerId', '==', cust.id),
        where('tenantId', '==', 1)
      ).pipe(take(1)).toPromise();

      outstandingCents = (orders || [])
        .filter(o => !o.isDeleted && o.status !== 'cancelled')
        .reduce((sum, o) => sum + (o.balanceCents || 0), 0);
    } catch (e) {
      console.error('Failed to verify outstanding balance', e);
      this.toast.error('Could not verify balance. Please try again.');
      return;
    }

    if (outstandingCents > 0) {
      alert(
        `Cannot delete ${cust.businessName}\n\n` +
        `This customer has ${this.formatCurrency(outstandingCents)} ` +
        `outstanding across unpaid orders.\n\n` +
        `Settle or cancel their unpaid orders before deleting.`
      );
      return;
    }

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

  async resetPassword() {
    const cust = this.customer();
    if (!cust) return;

    if (!confirm(`Send password reset email to ${cust.email}?`)) return;

    try {
      await this.firestore.addDocument('adminPasswordResets', {
        email: cust.email,
        customerId: cust.id,
        triggeredBy: this.auth.getActionBy(),
        processed: false,
        tenantId: 1,
        createdAt: serverTimestamp()
      });
      this.toast.success(`Password reset email sent to ${cust.email}`);
    } catch (error: any) {
      this.toast.error(error.message || 'Failed to send reset email');
    }
  }

  copyId() {
    const cust = this.customer();
    if (!cust) return;
    navigator.clipboard.writeText(cust.id);
    this.toast.success('Customer ID copied!');
  }
}
