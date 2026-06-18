import { Component, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';
import { where, orderBy } from '@angular/fire/firestore';
import { Customer } from '../../../core/models/customer.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';

interface ServiceArea {
  id: string;
  name: string;
  tenantId: number;
  isDeleted: boolean;
}

import { OwnerFullNamePipe } from '../../../shared/pipes/full-name.pipe';

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [FormsModule, RouterLink, StatusBadgeComponent, PageHeaderComponent, OwnerFullNamePipe],
  templateUrl: './admin-customers.component.html',
  styleUrl: './admin-customers.component.scss'
})
export class AdminCustomersComponent {
  private readonly firestore = inject(FirestoreService);
  protected readonly router = inject(Router);

  customers = signal<Customer[]>([]);
  serviceAreas = signal<ServiceArea[]>([]);
  isLoading = signal(true);

  searchQuery = signal('');
  statusFilter = signal('all');

  filteredCustomers = computed(() => {
    let result = this.customers();
    const query = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();

    if (query) {
      result = result.filter(c => 
        c.businessName.toLowerCase().includes(query) ||
        c.ownerFirstName.toLowerCase().includes(query) ||
        (c.ownerLastName || '').toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query) ||
        c.phone.toLowerCase().includes(query)
      );
    }

    if (status !== 'all') {
      result = result.filter(c => c.status === status);
    }

    return result;
  });

  stats = computed(() => {
    const all = this.customers();
    return {
      total: all.length,
      active: all.filter(c => c.status === 'active').length,
      pending: all.filter(c => c.status === 'pending').length,
      suspended: all.filter(c => c.status === 'suspended').length
    };
  });

  // Export State
  showExportModal = signal(false);
  exportIncludeSuspended = signal(true);

  exportPreviewCount = computed(() => {
    let list = [...this.filteredCustomers()];
    if (!this.exportIncludeSuspended()) {
      list = list.filter(
        c => c.status !== 'suspended'
      );
    }
    return list.length;
  });

  exportCustomers() {
    let list = [...this.filteredCustomers()];

    if (!this.exportIncludeSuspended()) {
      list = list.filter(
        c => c.status !== 'suspended'
      );
    }

    const headers = [
      'Customer ID', 'Business Name', 'Owner Name', 'Email',
      'Phone', 'City', 'Province', 'Service Area', 'Total Ordered', 'Total Owing', 'Status'
    ];

    const rows = list.map(c => [
      c.id,
      c.businessName,
      [c.ownerFirstName, c.ownerLastName].filter(Boolean).join(' '),
      c.email,
      c.phone,
      c.address?.city || '',
      c.address?.province || '',
      this.getServiceAreaName(c),
      this.formatCurrency(c.totalOrderedCents || 0),
      this.formatCurrency(c.totalOwingCents || 0),
      c.status
    ]);

    const csvContent = this.generateCsvContent(headers, rows);
    this.downloadCsv(`customers_export_${Date.now()}.csv`, csvContent);
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

  constructor() {
    this.loadData();
  }

  private loadData() {
    this.firestore.getCollection<Customer>(
      'customers',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false),
      orderBy('businessName')
    ).subscribe({
      next: (data) => {
        this.customers.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading customers:', err);
        this.isLoading.set(false);
      }
    });

    this.firestore.getCollection<ServiceArea>(
      'serviceAreas',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    ).subscribe({
      next: (data) => this.serviceAreas.set(data),
      error: (err) => console.error('Error loading service areas:', err)
    });
  }

  getServiceAreaName(customer: Customer): string {
    if (customer.serviceAreaId) {
      const sa = this.serviceAreas()
        .find(s => s.id === customer.serviceAreaId);
      return sa ? sa.name : 'Unknown Area';
    }
    // Fallback for legacy data only
    if (customer.serviceAreaCustom) {
      return customer.serviceAreaCustom +
        ' (legacy)';
    }
    return '—';
  }

  getInitials(name: string): string {
    return name ? name.substring(0, 2).toUpperCase() : '??';
  }

  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  goToDetails(id: string) {
    this.router.navigate(['/admin/customers', id]);
  }
}
