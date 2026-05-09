import { Component, inject, signal, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { where, orderBy, serverTimestamp } from '@angular/fire/firestore';

interface ServiceArea {
  id: string;
  name: string;
  notes?: string;
  active: boolean;
  tenantId: number;
  isDeleted: boolean;
}

interface Customer {
  id: string;
  serviceAreaId: string;
  tenantId: number;
  isDeleted: boolean;
}

@Component({
  selector: 'app-admin-service-areas',
  standalone: true,
  imports: [CommonModule, FormsModule, StatusBadgeComponent],
  templateUrl: './admin-service-areas.component.html',
  styleUrl: './admin-service-areas.component.scss'
})
export class AdminServiceAreasComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  serviceAreas = signal<ServiceArea[]>([]);
  customers = signal<Customer[]>([]);
  isLoading = signal(true);

  // Modal State
  showModal = signal(false);
  isEditing = signal(false);
  editingId = signal<string | null>(null);
  isSaving = signal(false);

  // Form State
  formName = signal('');
  formNotes = signal('');
  formActive = signal(true);

  // Delete State
  deletingId = signal<string | null>(null);

  constructor() {
    this.loadData();
  }

  private loadData() {
    this.firestore.getCollection<ServiceArea>(
      'service_areas',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false),
      orderBy('name', 'asc')
    ).subscribe({
      next: (data) => {
        this.serviceAreas.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading service areas:', err);
        this.toast.error('Failed to load service areas');
        this.isLoading.set(false);
      }
    });

    this.firestore.getCollection<Customer>(
      'customers',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    ).subscribe({
      next: (data) => this.customers.set(data),
      error: (err) => console.error('Error loading customers:', err)
    });
  }

  getCustomerCount(serviceAreaId: string): number {
    return this.customers().filter(c => c.serviceAreaId === serviceAreaId).length;
  }

  openAddModal() {
    this.formName.set('');
    this.formNotes.set('');
    this.formActive.set(true);
    this.isEditing.set(false);
    this.editingId.set(null);
    this.showModal.set(true);
  }

  openEditModal(area: ServiceArea) {
    this.formName.set(area.name);
    this.formNotes.set(area.notes || '');
    this.formActive.set(area.active);
    this.isEditing.set(true);
    this.editingId.set(area.id);
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.showModal()) {
      this.closeModal();
    }
  }

  async saveServiceArea() {
    if (!this.formName().trim()) {
      this.toast.warning('Please enter a name');
      return;
    }

    this.isSaving.set(true);
    
    try {
      const data = {
        name: this.formName().trim(),
        notes: this.formNotes().trim(),
        active: this.formActive(),
      };

      if (this.isEditing() && this.editingId()) {
        await this.firestore.updateDocument(`service_areas/${this.editingId()}`, data);
        this.toast.success('Service area updated successfully');
      } else {
        const newData = {
          ...data,
          tenantId: 1,
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: this.auth.getActionBy()
        };
        await this.firestore.addDocument('service_areas', newData);
        this.toast.success('Service area created successfully');
      }
      this.closeModal();
    } catch (err) {
      console.error('Error saving service area:', err);
      this.toast.error('Failed to save service area');
    } finally {
      this.isSaving.set(false);
    }
  }

  confirmDelete(id: string) {
    this.deletingId.set(id);
  }

  cancelDelete() {
    this.deletingId.set(null);
  }

  async deleteServiceArea(id: string) {
    const count = this.getCustomerCount(id);
    if (count > 0) {
      this.toast.error(`Cannot delete — ${count} customers are using this service area`);
      this.deletingId.set(null);
      return;
    }

    try {
      await this.firestore.softDelete(`service_areas/${id}`, this.auth.getActionBy()?.uid || 'unknown');
      this.toast.success('Service area deleted successfully');
    } catch (err) {
      console.error('Error deleting service area:', err);
      this.toast.error('Failed to delete service area');
    } finally {
      this.deletingId.set(null);
    }
  }
}
