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
import { SearchableSelectComponent, SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';

@Component({
  selector: 'app-review-modal',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    RouterLink, 
    StatusBadgeComponent, 
    SearchableSelectComponent, 
    LoadingSpinnerComponent
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

  isSaving = signal(false);
  
  // Approve form state
  serviceAreas = signal<SearchableSelectOption[]>([]);
  useCustomArea = signal(false);
  selectedAreaId = signal<string | null>(null);
  customAreaText = signal<string>('');
  customerStatus = signal<'active' | 'pending'>('active');
  approveNotes = signal<string>('');

  // Reject form state
  rejectNotes = signal<string>('');

  existingCustomerId = signal<string | null>(null);
  existingCustomerName = signal<string | null>(null);
  
  linkedCustomer = signal<any | null>(null);
  isLinkedCustomerDeleted = signal(false);

  async ngOnInit() {
    this.loadServiceAreas();
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
    } else if (this.request.serviceAreaCustom) {
      this.useCustomArea.set(true);
      this.customAreaText.set(this.request.serviceAreaCustom);
    }
  }

  loadServiceAreas() {
    this._firestore.getCollection<{id: string, name: string}>('serviceAreas')
      .subscribe(data => {
        const opts = data.map(sa => ({ value: sa.id, label: sa.name }));
        this.serviceAreas.set(opts);
      });
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

  onAreaSelect(opt: SearchableSelectOption) {
    this.selectedAreaId.set(opt.value);
  }

  async approve() {
    if (this.isSaving()) return;

    if (!this.useCustomArea() && !this.selectedAreaId()) {
      this._toast.error('Please select a service area or enter a custom one.');
      return;
    }

    if (this.useCustomArea() && !this.customAreaText().trim()) {
      this._toast.error('Please enter a custom service area.');
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
        ownerName: this.request.ownerName,
        email: this.request.email,
        phone: this.request.phone,
        businessType: this.request.businessType || null,
        businessTypeCustom: this.request.businessTypeCustom ?? null,
        address: this.request.address,
        serviceAreaId: !this.useCustomArea() ? (this.selectedAreaId() ?? null) : null,
        serviceAreaCustom: this.useCustomArea() ? (this.customAreaText().trim() || null) : null,
        message: this.request.message ?? null,
        logoUrl: null,
        notes: this.approveNotes().trim() || null,
        status: this.customerStatus(),
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

      await this._firestore.runBatch(async (batch, db) => {
        const { collection, doc } = await import('@angular/fire/firestore');
        const custRef = doc(collection(db, 'customers'));
        newCustomerId = custRef.id;
        batch.set(custRef, customerData);

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
        ownerName: this.request.ownerName,
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
