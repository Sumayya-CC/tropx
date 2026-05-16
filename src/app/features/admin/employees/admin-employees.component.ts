import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { AppUser, UserRole, UserStatus, getFullName } from '../../../core/models/user.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { EmployeeModalComponent } from './employee-modal/employee-modal.component';
import { where, serverTimestamp } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-admin-employees',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    PageHeaderComponent,
    StatusBadgeComponent,
    EmployeeModalComponent
  ],
  templateUrl: './admin-employees.component.html',
  styleUrls: ['./admin-employees.component.scss']
})
export class AdminEmployeesComponent {
  private firestore = inject(FirestoreService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  // Filters
  search = signal('');
  roleFilter = signal('all');
  statusFilter = signal('all');

  // Modal State
  isModalOpen = signal(false);
  selectedEmployee = signal<AppUser | undefined>(undefined);

  // Data Loading
  private rawEmployees$ = this.firestore.getCollection<AppUser>(
    'users',
    where('tenantId', '==', 1),
    where('isDeleted', '==', false)
  );

  employees = toSignal(this.rawEmployees$.pipe(
    map(users => users
      .filter(u => u.role !== 'customer')
      .map(u => ({
        ...u,
        status: u.status ?? 'active'
      }))
      .sort((a, b) => a.firstName.localeCompare(b.firstName))
    )
  ), { initialValue: [] });

  isLoading = computed(() => this.employees().length === 0 && this.isInitialLoading());
  private isInitialLoading = signal(true);

  constructor() {
    // Set isInitialLoading to false once we get the first data emit
    this.rawEmployees$.subscribe({
      next: () => this.isInitialLoading.set(false),
      error: () => this.isInitialLoading.set(false)
    });
  }

  // Filtered Data
  filteredEmployees = computed(() => {
    const all = this.employees();
    const search = this.search().toLowerCase();
    const role = this.roleFilter();
    const status = this.statusFilter();

    return all.filter(e => {
      const matchesSearch = !search || 
        e.firstName.toLowerCase().includes(search) || 
        e.lastName?.toLowerCase().includes(search) || 
        e.email.toLowerCase().includes(search);
      
      const matchesRole = role === 'all' || e.role === role;
      const matchesStatus = status === 'all' || e.status === status;

      return matchesSearch && matchesRole && matchesStatus;
    });
  });

  // Stats
  stats = computed(() => {
    const all = this.employees();
    return {
      total: all.length,
      active: all.filter(e => e.status === 'active').length,
      suspended: all.filter(e => e.status === 'suspended').length,
      admins: all.filter(e => e.role === 'admin').length
    };
  });

  // Actions
  openAddModal() {
    this.selectedEmployee.set(undefined);
    this.isModalOpen.set(true);
  }

  editEmployee(employee: AppUser) {
    this.selectedEmployee.set(employee);
    this.isModalOpen.set(true);
  }

  async toggleStatus(employee: AppUser) {
    // Prevent suspending yourself
    const currentUser = this.auth.currentUser();
    if (employee.uid === currentUser?.uid) {
      this.toast.error('You cannot suspend your own account');
      return;
    }

    const newStatus: UserStatus = employee.status === 'active' ? 'suspended' : 'active';
    const action = newStatus === 'suspended' ? 'disable' : 'enable';

    try {
      await this.firestore.updateDocument(`users/${employee.uid}`, {
        status: newStatus,
        updatedAt: serverTimestamp()
      });

      await this.firestore.addDocument('authActions', {
        action,
        uid: employee.uid,
        createdAt: serverTimestamp(),
        tenantId: 1
      });

      this.toast.success(`Employee ${newStatus === 'active' ? 'activated' : 'suspended'} successfully`);
    } catch (error: any) {
      this.toast.error(error.message || 'Failed to update status');
    }
  }

  onModalClosed(saved: boolean) {
    this.isModalOpen.set(false);
    this.selectedEmployee.set(undefined);
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

  getInitials(user: AppUser): string {
    const first = user.firstName?.[0] || '';
    const last = user.lastName?.[0] || '';
    return (first + last).toUpperCase();
  }

  getFullName(user: AppUser): string {
    return getFullName(user);
  }

  getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      admin: 'Admin',
      manager: 'Manager',
      sales_rep: 'Sales Rep',
      warehouse: 'Warehouse'
    };
    return labels[role] || role;
  }
}
