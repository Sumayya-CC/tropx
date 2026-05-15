import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AccessRequest, AccessRequestStatus } from '../../../core/models/access-request.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { ReviewModalComponent } from './review-modal/review-modal.component';
import { where } from '@angular/fire/firestore';

@Component({
  selector: 'app-admin-access-requests',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, StatusBadgeComponent, ReviewModalComponent],
  templateUrl: './admin-access-requests.component.html',
  styleUrl: './admin-access-requests.component.scss'
})
export class AdminAccessRequestsComponent implements OnInit {
  private readonly _firestore = inject(FirestoreService);

  requests = signal<AccessRequest[]>([]);
  isLoading = signal<boolean>(true);

  searchQuery = signal<string>('');
  statusFilter = signal<AccessRequestStatus | 'all'>('pending');
  dateFilter = signal<'today' | '7days' | '30days' | 'all'>('all');
  deletedCustomers = signal<Map<string, any>>(new Map());

  selectedRequest = signal<AccessRequest | null>(null);

  ngOnInit() {
    this.loadRequests();
    this.loadDeletedCustomerIds();
  }

  loadDeletedCustomerIds() {
    this._firestore.getCollection<any>(
      'customers',
      where('tenantId', '==', 1),
      where('isDeleted', '==', true)
    ).subscribe(deleted => {
      const map = new Map<string, any>();
      deleted.forEach(c => map.set(c.id, c));
      this.deletedCustomers.set(map);
    });
  }

  loadRequests() {
    this.isLoading.set(true);
    this._firestore.getCollection<AccessRequest>(
      'accessRequests',
      where('tenantId', '==', 1)
    ).subscribe(data => {
      // Filter out deleted in memory and sort by submittedAt
      const valid = data.filter(r => !r.isDeleted)
        .sort((a, b) => {
          const aTime = a.submittedAt?.seconds ?? a.createdAt?.seconds ?? 0;
          const bTime = b.submittedAt?.seconds ?? b.createdAt?.seconds ?? 0;
          return bTime - aTime;
        });
      this.requests.set(valid);
      this.isLoading.set(false);
    });
  }

  filteredRequests = computed(() => {
    let filtered = this.requests();
    
    // Status filter
    const status = this.statusFilter();
    if (status !== 'all') {
      filtered = filtered.filter(r => r.status === status);
    }

    // Date filter
    const dateF = this.dateFilter();
    if (dateF !== 'all') {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      let threshold = now.getTime();
      
      if (dateF === '7days') threshold -= 7 * 24 * 60 * 60 * 1000;
      else if (dateF === '30days') threshold -= 30 * 24 * 60 * 60 * 1000;

      filtered = filtered.filter(r => {
        const time = r.createdAt?.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt).getTime();
        return time >= threshold;
      });
    }

    // Search query
    const search = this.searchQuery().toLowerCase().trim();
    if (search) {
      filtered = filtered.filter(r => 
        r.businessName.toLowerCase().includes(search) ||
        r.ownerName.toLowerCase().includes(search) ||
        r.email.toLowerCase().includes(search)
      );
    }

    return filtered;
  });

  stats = computed(() => {
    const reqs = this.requests();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let total = reqs.length;
    let pending = 0;
    let approvedMonth = 0;
    let rejectedMonth = 0;

    reqs.forEach(r => {
      if (r.status === 'pending') pending++;
      
      const reviewTime = r.reviewedAt?.toDate ? r.reviewedAt.toDate().getTime() : (r.reviewedAt ? new Date(r.reviewedAt).getTime() : 0);
      if (reviewTime >= startOfMonth) {
        if (r.status === 'approved') approvedMonth++;
        if (r.status === 'rejected') rejectedMonth++;
      }
    });

    return { total, pending, approvedMonth, rejectedMonth };
  });

  isLinkedCustomerDeleted(request: AccessRequest): boolean {
    if (!request.linkedCustomerId) return false;
    return this.deletedCustomers().has(request.linkedCustomerId);
  }

  getDeletedCustomer(request: AccessRequest): any {
    if (!request.linkedCustomerId) return null;
    return this.deletedCustomers().get(request.linkedCustomerId);
  }

  openReview(req: AccessRequest) {
    this.selectedRequest.set(req);
  }

  closeReview(result: 'approved' | 'rejected' | null) {
    this.selectedRequest.set(null);
  }

  formatDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric', 
      year: 'numeric'
    });
  }

  formatTime(ts: any): string {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString('en-CA', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
}
