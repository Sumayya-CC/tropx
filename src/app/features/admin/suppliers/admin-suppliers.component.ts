import { Component, inject, signal, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { where, orderBy, serverTimestamp, collection, getDocs, query, Firestore } from '@angular/fire/firestore';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { Supplier } from '../../../core/models/supplier.model';

@Component({
  selector: 'app-admin-suppliers',
  standalone: true,
  imports: [CommonModule, FormsModule, StatusBadgeComponent, PageHeaderComponent],
  templateUrl: './admin-suppliers.component.html',
  styleUrl: './admin-suppliers.component.scss'
})
export class AdminSuppliersComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly db = inject(Firestore);

  suppliers = signal<Supplier[]>([]);
  isLoading = signal(true);

  // Modal State
  showModal = signal(false);
  isEditing = signal(false);
  editingId = signal<string | null>(null);
  isSaving = signal(false);

  // Form State
  formName = signal('');
  formDisplayName = signal('');
  formContactFirstName = signal('');
  formContactLastName = signal('');
  formEmail = signal('');
  formPhone = signal('');
  formStreet = signal('');
  formCity = signal('');
  formProvince = signal('');
  formPostalCode = signal('');
  formCountry = signal('');
  formPaymentTermsDays = signal(30);
  formLeadTimeDays = signal(7);
  formNotes = signal('');
  formActive = signal(true);

  // Delete State
  deletingId = signal<string | null>(null);

  constructor() {
    this.loadData();
  }

  private loadData() {
    this.firestore.getCollection<Supplier>(
      'suppliers',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false),
      orderBy('displayName', 'asc')
    ).subscribe({
      next: (data) => {
        this.suppliers.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading suppliers:', err);
        this.toast.error('Failed to load suppliers');
        this.isLoading.set(false);
      }
    });
  }

  openAddModal() {
    this.formName.set('');
    this.formDisplayName.set('');
    this.formContactFirstName.set('');
    this.formContactLastName.set('');
    this.formEmail.set('');
    this.formPhone.set('');
    this.formStreet.set('');
    this.formCity.set('');
    this.formProvince.set('');
    this.formPostalCode.set('');
    this.formCountry.set('');
    this.formPaymentTermsDays.set(30);
    this.formLeadTimeDays.set(7);
    this.formNotes.set('');
    this.formActive.set(true);
    this.isEditing.set(false);
    this.editingId.set(null);
    this.showModal.set(true);
  }

  openEditModal(supplier: Supplier) {
    this.formName.set(supplier.name);
    this.formDisplayName.set(supplier.displayName);
    this.formContactFirstName.set(supplier.contactFirstName || '');
    this.formContactLastName.set(supplier.contactLastName || '');
    this.formEmail.set(supplier.email || '');
    this.formPhone.set(supplier.phone || '');
    this.formStreet.set(supplier.street || '');
    this.formCity.set(supplier.city || '');
    this.formProvince.set(supplier.province || '');
    this.formPostalCode.set(supplier.postalCode || '');
    this.formCountry.set(supplier.country || '');
    this.formPaymentTermsDays.set(supplier.paymentTermsDays || 30);
    this.formLeadTimeDays.set(supplier.leadTimeDays || 7);
    this.formNotes.set(supplier.notes || '');
    this.formActive.set(supplier.active);
    this.isEditing.set(true);
    this.editingId.set(supplier.id);
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

  async saveSupplier() {
    if (!this.formName().trim() || !this.formDisplayName().trim()) {
      this.toast.warning('Please enter a name and display name');
      return;
    }

    this.isSaving.set(true);
    
    try {
      const data: Partial<Supplier> = {
        name: this.formName().trim(),
        displayName: this.formDisplayName().trim(),
        contactFirstName: this.formContactFirstName().trim(),
        contactLastName: this.formContactLastName().trim(),
        email: this.formEmail().trim(),
        phone: this.formPhone().trim(),
        street: this.formStreet().trim(),
        city: this.formCity().trim(),
        province: this.formProvince().trim(),
        postalCode: this.formPostalCode().trim(),
        country: this.formCountry().trim(),
        paymentTermsDays: this.formPaymentTermsDays(),
        leadTimeDays: this.formLeadTimeDays(),
        currencyCode: 'CAD',
        notes: this.formNotes().trim(),
        active: this.formActive(),
      };

      if (this.isEditing() && this.editingId()) {
        await this.firestore.updateDocument(`suppliers/${this.editingId()}`, data);
        this.toast.success('Supplier updated successfully');
      } else {
        const newData = {
          ...data,
          tenantId: 1,
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: this.auth.getActionBy()
        };
        await this.firestore.addDocument('suppliers', newData);
        this.toast.success('Supplier created successfully');
      }
      this.closeModal();
    } catch (err) {
      console.error('Error saving supplier:', err);
      this.toast.error('Failed to save supplier');
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

  async deleteSupplier(id: string) {
    try {
      // Check for dependencies
      const poRef = collection(this.db, 'purchaseOrders');
      const q = query(
        poRef,
        where('supplierId', '==', id),
        where('isDeleted', '==', false)
      );
      const snap = await getDocs(q);
      const count = snap.size;

      if (count > 0) {
        this.toast.error(`Cannot delete — ${count} purchase orders reference this supplier`);
        this.deletingId.set(null);
        return;
      }

      await this.firestore.softDelete(`suppliers/${id}`, this.auth.getActionBy()?.uid || 'unknown');
      this.toast.success('Supplier deleted successfully');
    } catch (err) {
      console.error('Error deleting supplier:', err);
      this.toast.error('Failed to delete supplier');
    } finally {
      this.deletingId.set(null);
    }
  }
}
