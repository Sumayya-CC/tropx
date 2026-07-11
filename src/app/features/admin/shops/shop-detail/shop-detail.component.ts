import { Component, inject, signal, effect } from '@angular/core';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { Shop } from '../../../../core/models/shop.model';
import { Customer } from '../../../../core/models/customer.model';
import { serverTimestamp } from '@angular/fire/firestore';
import { OwnerFullNamePipe } from '../../../../shared/pipes/full-name.pipe';
import { ShopLinkService } from '../../../../core/services/shop-link.service';
import { EntityLinkModalComponent, LinkableItem } from '../../../../shared/components/entity-link-modal/entity-link-modal.component';

@Component({
  selector: 'app-shop-detail',
  standalone: true,
  imports: [RouterLink, LoadingSpinnerComponent, OwnerFullNamePipe, EntityLinkModalComponent],
  templateUrl: './shop-detail.component.html',
  styleUrl: './shop-detail.component.scss'
})
export class ShopDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly shopLink = inject(ShopLinkService);

  shop = signal<Shop | null>(null);
  linkedCustomer = signal<Customer | null>(null);
  isLoading = signal(true);
  
  showLinkModal = signal(false);
  linkItems = signal<LinkableItem[]>([]);
  linkSuggestedIds = signal<string[]>([]);
  linkBusy = signal(false);

  constructor() {
    effect(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id) this.loadShop(id);
    });
  }

  private loadShop(id: string) {
    this.firestore.getDocument<Shop>(`shops/${id}`).subscribe({
      next: (data) => {
        if (!data || data.isDeleted) {
          this.toast.error('Shop not found'); this.router.navigate(['/admin/shops']); return;
        }
        this.shop.set(data);
        this.isLoading.set(false);
        if (data.linkedCustomerId) this.loadLinkedCustomer(data.linkedCustomerId);
      },
      error: (err) => {
        console.error('Failed to load shop', err);
        this.toast.error('Failed to load shop'); this.router.navigate(['/admin/shops']);
      }
    });
  }

  private loadLinkedCustomer(customerId: string) {
    this.firestore.getDocument<Customer>(`customers/${customerId}`).subscribe({
      next: (c) => this.linkedCustomer.set(c && !c.isDeleted ? c : null),
      error: () => this.linkedCustomer.set(null)
    });
  }

  statusLabel(): string {
    const s = this.shop()?.status;
    return s ? ({ prospect: 'Prospect', customer: 'Customer', not_interested: 'Not Interested', dormant: 'Dormant' } as any)[s] ?? s : '';
  }

  pipelineLabel(): string {
    const p = this.shop()?.pipelineStage;
    if (!p) return '';
    return ({
      first_contact: 'First Contact', manager_meeting: 'Manager Meeting',
      sample_left: 'Sample Left', decision: 'Decision', opened: 'Opened',
    } as any)[p] ?? p;
  }

  getInitials(name: string): string {
    return name ? name.substring(0, 2).toUpperCase() : '??';
  }

  managerName(): string {
    const s = this.shop();
    return s ? [s.managerFirstName, s.managerLastName].filter(Boolean).join(' ') : '';
  }

  makeCustomer() {
    const s = this.shop();
    if (!s) return;
    if (s.linkedCustomerId) { this.router.navigate(['/admin/customers', s.linkedCustomerId]); return; }
    this.openPicker(s);
  }

  private async openPicker(s: Shop) {
    this.linkBusy.set(true);
    try {
      const [suggestions, browse] = await Promise.all([
        this.shopLink.findCustomerSuggestionsForShop(s),
        this.shopLink.listCustomersWithoutShop(),
      ]);
      const suggestedIds = suggestions.map(c => c.id);
      const merged = [...suggestions, ...browse].filter(
        (c, i, arr) => arr.findIndex(x => x.id === c.id) === i
      );
      this.linkItems.set(merged.map(c => ({
        id: c.id,
        primaryText: c.businessName,
        secondaryText: [c.address?.city, c.phone].filter(Boolean).join(' · '),
      })));
      this.linkSuggestedIds.set(suggestedIds);
      this.showLinkModal.set(true);
    } catch (e) {
      console.error('Failed to load customers for linking', e);
      this.toast.error('Could not load customers');
    } finally {
      this.linkBusy.set(false);
    }
  }

  async onLinkCustomer(customerId: string) {
    const s = this.shop();
    if (!s) return;
    this.linkBusy.set(true);
    try {
      await this.shopLink.linkCustomerAndShop(customerId, s.id);
      this.toast.success('Shop linked to customer');
      this.showLinkModal.set(false);
      this.loadShop(s.id); 
    } catch (e) {
      console.error('Link failed', e);
      this.toast.error('Failed to link');
    } finally {
      this.linkBusy.set(false);
    }
  }

  onAddNewCustomer() {
    const s = this.shop();
    if (!s) return;
    this.router.navigate(['/admin/customers/add'], { queryParams: { fromShop: s.id } });
  }

  async deleteShop() {
    const s = this.shop();
    if (!s) return;
    if (!confirm(`Delete ${s.name}? A linked customer, if any, is not deleted.`)) return;
    try {
      await this.firestore.updateDocument(`shops/${s.id}`, {
        isDeleted: true, isDeletedAt: serverTimestamp(), deletedBy: this.auth.getActionBy()
      });
      this.toast.success('Shop deleted');
      this.router.navigate(['/admin/shops']);
    } catch (e) {
      console.error('Delete failed', e);
      this.toast.error('Failed to delete shop');
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
    const s = this.shop();
    const custId = s?.linkedCustomerId;
    if (!s || !custId) return;
    this.unlinkBusy.set(true);
    try {
      await this.shopLink.unlinkCustomerAndShop(custId, s.id, this.unlinkNewStatus());
      this.toast.success('Unlinked. Shop status updated.');
      this.showUnlinkDialog.set(false);
      this.linkedCustomer.set(null);
      this.loadShop(s.id); // reload to reflect new status + cleared link
    } catch (e) {
      console.error('Unlink failed', e);
      this.toast.error('Failed to unlink');
    } finally {
      this.unlinkBusy.set(false);
    }
  }
}
