import { Component, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { centsToDisplay } from '../../../shared/utils/currency.utils';
import { where, orderBy } from '@angular/fire/firestore';
import { Customer } from '../../../core/models/customer.model';

interface ServiceArea {
  id: string;
  name: string;
  tenantId: number;
  isDeleted: boolean;
}

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [FormsModule, RouterLink, StatusBadgeComponent],
  templateUrl: './admin-customers.component.html',
  styleUrl: './admin-customers.component.scss'
})
export class AdminCustomersComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly router = inject(Router);

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
        c.ownerName.toLowerCase().includes(query) ||
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
    if (customer.serviceAreaCustom) {
      return customer.serviceAreaCustom;
    }
    if (customer.serviceAreaId) {
      const sa = this.serviceAreas().find(s => s.id === customer.serviceAreaId);
      return sa ? sa.name : 'Unknown';
    }
    return 'None';
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
