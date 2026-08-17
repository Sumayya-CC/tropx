import { Component, computed, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ContactInquiry, ContactInquiryStatus } from '../../../core/models/contact-inquiry.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { ContactInquiryDetailModalComponent } from './detail-modal/contact-inquiry-detail-modal.component';

@Component({
  selector: 'app-admin-contact-inquiries',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, StatusBadgeComponent, ContactInquiryDetailModalComponent],
  templateUrl: './admin-contact-inquiries.component.html',
  styleUrl: './admin-contact-inquiries.component.scss'
})
export class AdminContactInquiriesComponent implements OnInit {
  private readonly _firestore = inject(FirestoreService);
  private readonly destroyRef = inject(DestroyRef);

  inquiries = signal<ContactInquiry[]>([]);
  isLoading = signal<boolean>(true);

  searchQuery = signal<string>('');
  statusFilter = signal<ContactInquiryStatus | 'all'>('new');
  dateFilter = signal<'today' | '7days' | '30days' | 'all'>('all');

  selectedInquiry = signal<ContactInquiry | null>(null);

  ngOnInit() {
    this.loadInquiries();
  }

  loadInquiries() {
    this.isLoading.set(true);
    this._firestore.getCollection<ContactInquiry>(
      'contactInquiries',
      where('tenantId', '==', 1)
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(data => {
      const sorted = [...data].sort((a, b) => {
        const aTime = a.createdAt?.seconds ?? 0;
        const bTime = b.createdAt?.seconds ?? 0;
        return bTime - aTime;
      });
      this.inquiries.set(sorted);
      this.isLoading.set(false);

      const selected = this.selectedInquiry();
      if (selected) {
        const fresh = sorted.find(i => i.id === selected.id);
        this.selectedInquiry.set(fresh ?? null);
      }
    });
  }

  filteredInquiries = computed(() => {
    let filtered = this.inquiries();

    const status = this.statusFilter();
    if (status !== 'all') {
      filtered = filtered.filter(i => i.status === status);
    }

    const dateF = this.dateFilter();
    if (dateF !== 'all') {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      let threshold = now.getTime();

      if (dateF === '7days') threshold -= 7 * 24 * 60 * 60 * 1000;
      else if (dateF === '30days') threshold -= 30 * 24 * 60 * 60 * 1000;

      filtered = filtered.filter(i => this.toDate(i.createdAt).getTime() >= threshold);
    }

    const search = this.searchQuery().toLowerCase().trim();
    if (search) {
      filtered = filtered.filter(i =>
        i.name.toLowerCase().includes(search) ||
        i.businessName.toLowerCase().includes(search) ||
        i.email.toLowerCase().includes(search) ||
        (i.message || '').toLowerCase().includes(search)
      );
    }

    return filtered;
  });

  stats = computed(() => {
    const all = this.inquiries();
    const total = all.length;
    const newCount = all.filter(i => i.status === 'new').length;
    const resolved = all.filter(i => i.status === 'resolved').length;
    return { total, newCount, resolved };
  });

  openDetail(inquiry: ContactInquiry) {
    this.selectedInquiry.set(inquiry);
    if (inquiry.status === 'new') {
      this.setStatus(inquiry, 'read');
    }
  }

  closeDetail() {
    this.selectedInquiry.set(null);
  }

  async setStatus(inquiry: ContactInquiry, status: ContactInquiryStatus) {
    if (inquiry.status === status) return;
    await this._firestore.updateDocument(`contactInquiries/${inquiry.id}`, { status });
  }

  toDate(ts: any): Date {
    if (!ts) return new Date(0);
    return ts.toDate ? ts.toDate() : new Date(ts);
  }

  formatDate(ts: any): string {
    if (!ts) return '—';
    return this.toDate(ts).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatTime(ts: any): string {
    if (!ts) return '';
    return this.toDate(ts).toLocaleTimeString('en-CA', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
}
