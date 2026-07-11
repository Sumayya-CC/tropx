import { Component, EventEmitter, Input, Output, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { serverTimestamp, where } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';

import { AccessRequest } from '../../../../core/models/access-request.model';
import { Customer } from '../../../../core/models/customer.model';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { ServiceAreaSelectComponent } from '../../../../shared/components/service-area-select/service-area-select.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';

import { FullNamePipe, OwnerFullNamePipe } from '../../../../shared/pipes/full-name.pipe';
import { ShopLinkService } from '../../../../core/services/shop-link.service';
import { Shop } from '../../../../core/models/shop.model';
import { normalizeSearchName } from '../../../../shared/utils/text.utils';
import { EntityLinkModalComponent, LinkableItem } from '../../../../shared/components/entity-link-modal/entity-link-modal.component';

@Component({
  selector: 'app-review-modal',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    RouterLink, 
    StatusBadgeComponent, 
    ServiceAreaSelectComponent, 
    LoadingSpinnerComponent,
    FullNamePipe,
    OwnerFullNamePipe,
    EntityLinkModalComponent
  ],
  templateUrl: './review-modal.component.html',
  styleUrl: './review-modal.component.scss'
})
export class ReviewModalComponent implements OnInit {
  @Input({ required: true }) request!: AccessRequest;
  @Output() closed = new EventEmitter<'approved' | 'rejected' | null>();

  private readonly _firestore = inject(FirestoreService);
  private readonly _auth = inject(AuthService);
  private readonly _toast = inject(ToastService);
  private readonly _router = inject(Router);
  private readonly shopLink = inject(ShopLinkService);

  isSaving = signal(false);
  
  // Approve form state
  selectedAreaId = signal<string | null>(null);
  selectedAreaName = signal<string>('');
  customerStatus = signal<'active' | 'pending'>('active');
  approveNotes = signal<string>('');

  // Reject form state
  rejectNotes = signal<string>('');

  existingCustomerId = signal<string | null>(null);
  existingCustomerName = signal<string | null>(null);
  
  linkedCustomer = signal<any | null>(null);
  isLinkedCustomerDeleted = signal(false);

  shopChoice = signal<'skip' | 'existing' | 'new'>('skip');
  selectedShopId = signal<string | null>(null);
  selectedShopName = signal<string>('');
  suggestedShops = signal<Shop[]>([]);
  private loadedShops = signal<Map<string, Shop>>(new Map());

  // Browse-all sub-modal
  showShopBrowse = signal(false);
  browseItems = signal<LinkableItem[]>([]);
  browseSuggestedIds = signal<string[]>([]);

  async ngOnInit() {
    await this.checkForDuplicateEmail();
    
    if (this.request.status === 'approved' && this.request.linkedCustomerId) {
      this._firestore
         .getDocument<any>(`customers/${this.request.linkedCustomerId}`)
        .subscribe(customer => {
          this.linkedCustomer.set(customer);
          this.isLinkedCustomerDeleted.set(customer?.isDeleted === true);
        });
    }

    if (this.request.serviceAreaId) {
      this.selectedAreaId.set(this.request.serviceAreaId);
    }
    
    if (this.request.status === 'pending') {
      try {
        // AccessRequest has phone + businessName, which the suggestion query reads.
        const matches = await this.shopLink.findShopSuggestionsForCustomer(this.request as any);
        this.suggestedShops.set(matches);
        const map = new Map<string, Shop>();
        matches.forEach(s => map.set(s.id, s));
        this.loadedShops.set(map);
        // Auto-preselect the single strongest match, but it stays clearable.
        if (matches.length === 1) {
          this.selectedShopId.set(matches[0].id);
          this.selectedShopName.set(matches[0].name);
          this.shopChoice.set('existing');
        }
      } catch (e) {
        console.error('Failed to load shop suggestions', e);
      }
    }
  }

  async checkForDuplicateEmail() {
    if (this.request.status !== 'pending') return;
    
    try {
      const existing = await firstValueFrom(
        this._firestore.getCollection<any>(
          'customers',
          where('email', '==', this.request.email),
          where('isDeleted', '==', false)
        )
      );

      if (existing.length > 0) {
        this.existingCustomerId.set(existing[0].id);
        this.existingCustomerName.set(existing[0].businessName);
      }
    } catch (err) {
      console.error('Error checking duplicate email:', err);
    }
  }

  onServiceAreaChanged(area: { id: string; name: string } | null) {
    if (area) {
      this.selectedAreaId.set(area.id);
      this.selectedAreaName.set(area.name);
    } else {
      this.selectedAreaId.set(null);
      this.selectedAreaName.set('');
    }
  }

  chooseSkipShop() {
    this.shopChoice.set('skip');
    this.selectedShopId.set(null);
    this.selectedShopName.set('');
  }

  chooseNewShop() {
    this.shopChoice.set('new');
    this.selectedShopId.set(null);
    this.selectedShopName.set('');
  }

  chooseExistingShop(shop: Shop) {
    this.shopChoice.set('existing');
    this.selectedShopId.set(shop.id);
    this.selectedShopName.set(shop.name);
    this.loadedShops.update(m => { m.set(shop.id, shop); return new Map(m); });
  }

  async openShopBrowse() {
    try {
      const browse = await this.shopLink.listShopsWithoutCustomer();
      const map = this.loadedShops();
      browse.forEach(s => map.set(s.id, s));
      this.loadedShops.set(new Map(map));
      this.browseItems.set(browse.map(s => ({
        id: s.id,
        primaryText: s.name,
        secondaryText: [s.address?.city, s.phone].filter(Boolean).join(' · '),
      })));
      this.browseSuggestedIds.set(this.suggestedShops().map(s => s.id));
      this.showShopBrowse.set(true);
    } catch (e) {
      console.error('Failed to load shops', e);
      this._toast.error('Could not load shops');
    }
  }

  onBrowsePickShop(shopId: string) {
    const shop = this.loadedShops().get(shopId);
    if (shop) this.chooseExistingShop(shop);
    this.showShopBrowse.set(false);
  }

  private hasAddress(a: any): boolean {
    return !!(a && (a.street || a.city || a.province || a.postalCode));
  }

  async approve() {
    if (this.isSaving()) return;

    if (!this.selectedAreaId()) {
      this._toast.error('Please select a service area.');
      return;
    }

    this.isSaving.set(true);
    this.existingCustomerId.set(null);
    this.existingCustomerName.set(null);

    // Check for existing customer with same email
    try {
      const existing = await firstValueFrom(
        this._firestore.getCollection<Customer>(
          'customers',
          where('email', '==', this.request.email),
          where('isDeleted', '==', false)
        )
      );

      if (existing.length > 0) {
        const existingCustomer = existing[0];
        this._toast.error(`A customer with this email already exists: ${existingCustomer.businessName}`);
        this.existingCustomerId.set(existingCustomer.id);
        this.existingCustomerName.set(existingCustomer.businessName);
        this.isSaving.set(false);
        return;
      }
    } catch (err) {
      console.error('Error checking for existing customer:', err);
    }

    const actionBy = this._auth.getActionBy();

    try {
      const customerData: any = {
        businessName: this.request.businessName,
        ownerFirstName: this.request.ownerFirstName,
        ownerLastName: this.request.ownerLastName ?? null,
        email: this.request.email,
        phone: this.request.phone,
        businessType: this.request.businessType || null,
        businessTypeCustom: this.request.businessTypeCustom ?? null,
        address: this.request.address,
        serviceAreaId: this.selectedAreaId(),
        serviceAreaCustom: null,
        message: this.request.message ?? null,
        logoUrl: null,
        notes: this.approveNotes().trim() || null,
        status: this.customerStatus(),
        searchName: normalizeSearchName(this.request.businessName),
        source: 'access_request',
        linkedRequestId: this.request.id,
        tenantId: this.request.tenantId,
        isDeleted: false,
        totalOrderedCents: 0,
        totalPaidCents: 0,
        totalOwingCents: 0,
        currencyCode: 'CAD',
        createdAt: serverTimestamp() as any,
        createdBy: actionBy || null,
        approvedBy: actionBy || null
      };

      let newCustomerId = '';

      const shopChoice = this.shopChoice();
      let existingShop: Shop | null = null;
      if (shopChoice === 'existing' && this.selectedShopId()) {
        existingShop = this.loadedShops().get(this.selectedShopId()!) ?? null;
        if (!existingShop) {
          try {
            existingShop = await firstValueFrom(
              this._firestore.getDocument<Shop>(`shops/${this.selectedShopId()}`)
            );
          } catch { existingShop = null; }
        }
      }
      const requestHasAddr = this.hasAddress(this.request.address);

      await this._firestore.runBatch(async (batch, db) => {
        const { collection, doc } = await import('@angular/fire/firestore');
        const custRef = doc(collection(db, 'customers'));
        newCustomerId = custRef.id;

        let linkedShopId: string | null = null;

        if (shopChoice === 'new') {
          const shopRef = doc(collection(db, 'shops'));
          linkedShopId = shopRef.id;
          batch.set(shopRef, {
            name: this.request.businessName,
            ownerFirstName: this.request.ownerFirstName,
            ownerLastName: this.request.ownerLastName ?? null,
            phone: this.request.phone,
            address: this.request.address ?? null,
            searchName: normalizeSearchName(this.request.businessName),
            status: 'customer',
            linkedCustomerId: custRef.id,
            hasCustomer: true,
            tenantId: this.request.tenantId,
            isDeleted: false,
            createdAt: serverTimestamp() as any,
            createdBy: actionBy || null,
          });
        } else if (shopChoice === 'existing' && existingShop) {
          linkedShopId = existingShop.id;
          const shopUpdate: any = {
            linkedCustomerId: custRef.id,
            hasCustomer: true,
            status: 'customer',
          };
          if (!this.hasAddress(existingShop.address) && requestHasAddr) {
            shopUpdate.address = this.request.address;
          }
          batch.update(doc(db, 'shops', existingShop.id), shopUpdate);
        }

        batch.set(custRef, {
          ...customerData,
          linkedShopId,
          hasShop: linkedShopId != null,
        });

        const reqRef = doc(db, 'accessRequests', this.request.id);
        batch.update(reqRef, {
          status: 'approved',
          reviewedAt: serverTimestamp(),
          reviewedBy: actionBy,
          linkedCustomerId: custRef.id,
          internalNotes: this.approveNotes().trim() || null
        });
      });

      await this._firestore.addDocument('accessRequestApprovals', {
        email: this.request.email,
        ownerFirstName: this.request.ownerFirstName,
        ownerLastName: this.request.ownerLastName ?? null,
        businessName: this.request.businessName,
        requestId: this.request.id,
        customerId: newCustomerId,
        processed: false,
        tenantId: 1,
        createdAt: serverTimestamp() as any
      });

      this._toast.success('Application approved — welcome email will be sent shortly');
      this.closed.emit('approved');
    } catch (err) {
      console.error(err);
      this._toast.error('Failed to approve application.');
    } finally {
      this.isSaving.set(false);
    }
  }

  async reject() {
    if (this.isSaving()) return;
    this.isSaving.set(true);
    const actionBy = this._auth.getActionBy();

    try {
      await this._firestore.updateDocument(`accessRequests/${this.request.id}`, {
        status: 'rejected',
        reviewedAt: serverTimestamp(),
        reviewedBy: actionBy,
        internalNotes: this.rejectNotes().trim() || null
      });

      this._toast.success('Application rejected');
      this.closed.emit('rejected');
    } catch (err) {
      console.error(err);
      this._toast.error('Failed to reject application.');
    } finally {
      this.isSaving.set(false);
    }
  }

  async resetToPending() {
    if (this.isSaving()) return;
    this.isSaving.set(true);

    try {
      await this._firestore.updateDocument(`accessRequests/${this.request.id}`, {
        status: 'pending'
      });

      this._toast.success('Application reset to pending');
      this.closed.emit(null);
    } catch (err) {
      console.error(err);
      this._toast.error('Failed to reset application.');
    } finally {
      this.isSaving.set(false);
    }
  }

  formatDate(timestamp: any): Date | null {
    if (!timestamp) return null;
    return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  }

  viewCustomer() {
    if (this.request.linkedCustomerId) {
      this.closed.emit(null);
      this._router.navigate(['/admin/customers', this.request.linkedCustomerId]);
    } else {
      this._toast.error('Customer record not linked to this request.');
    }
  }

  closeModal() {
    this.closed.emit(null);
  }

  formatAddress(): string {
    const { street, city, province, postalCode, country } = this.request.address;
    return [street, city, province, postalCode, country].filter(Boolean).join(', ');
  }

  reviewerName = computed(() => {
    if (!this.request.reviewedBy) return 'Unknown';
    return `${this.request.reviewedBy.firstName} ${this.request.reviewedBy.lastName || ''}`.trim();
  });
}
