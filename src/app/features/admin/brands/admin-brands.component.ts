import { Component, inject, signal, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { where, orderBy, serverTimestamp } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';

interface Brand {
  id: string;
  name: string;
  active: boolean;
  tenantId: number;
  isDeleted: boolean;
  logoUrl?: string;
}

interface Product {
  id: string;
  brandId: string;
  tenantId: number;
  isDeleted: boolean;
}

@Component({
  selector: 'app-admin-brands',
  standalone: true,
  imports: [CommonModule, FormsModule, StatusBadgeComponent, PageHeaderComponent],
  templateUrl: './admin-brands.component.html',
  styleUrl: './admin-brands.component.scss'
})
export class AdminBrandsComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(Storage);

  brands = signal<Brand[]>([]);
  products = signal<Product[]>([]);
  isLoading = signal(true);

  // Logo Upload State
  formLogoUrl = signal('');
  formLogoFile = signal<File | null>(null);
  formLogoPreview = signal('');
  isUploadingLogo = signal(false);
  lightboxImageUrl = signal<string | null>(null);

  // Modal State
  showModal = signal(false);
  isEditing = signal(false);
  editingId = signal<string | null>(null);
  isSaving = signal(false);

  // Form State
  formName = signal('');
  formActive = signal(true);

  // Delete State
  deletingId = signal<string | null>(null);

  constructor() {
    this.loadData();
  }

  private loadData() {
    this.firestore.getCollection<Brand>(
      'brands',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false),
      orderBy('name', 'asc')
    ).subscribe({
      next: (data) => {
        this.brands.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading brands:', err);
        this.toast.error('Failed to load brands');
        this.isLoading.set(false);
      }
    });

    this.firestore.getCollection<Product>(
      'products',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    ).subscribe({
      next: (data) => this.products.set(data),
      error: (err) => console.error('Error loading products:', err)
    });
  }

  getProductCount(brandId: string): number {
    return this.products().filter(p => p.brandId === brandId).length;
  }

  openAddModal() {
    this.formName.set('');
    this.formActive.set(true);
    this.formLogoUrl.set('');
    this.formLogoFile.set(null);
    this.formLogoPreview.set('');
    this.isEditing.set(false);
    this.editingId.set(null);
    this.showModal.set(true);
  }

  openEditModal(brand: Brand) {
    this.formName.set(brand.name);
    this.formActive.set(brand.active);
    this.formLogoUrl.set(brand.logoUrl || '');
    this.formLogoPreview.set(brand.logoUrl || '');
    this.formLogoFile.set(null);
    this.isEditing.set(true);
    this.editingId.set(brand.id);
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

  onLogoSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toast.error('Please select an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.toast.error('Image must be under 2MB');
      return;
    }
    this.formLogoFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) =>
      this.formLogoPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  removeLogo() {
    this.formLogoFile.set(null);
    this.formLogoPreview.set('');
    this.formLogoUrl.set('');
  }

  async saveBrand() {
    if (!this.formName().trim()) {
      this.toast.warning('Please enter a name');
      return;
    }

    this.isSaving.set(true);
    
    try {
      let finalLogoUrl = this.formLogoUrl();

      if (this.formLogoFile()) {
        this.isUploadingLogo.set(true);
        const file = this.formLogoFile()!;
        const path = `brands/${Date.now()}_${file.name}`;
        const storageRef = ref(this.storage, path);
        await uploadBytes(storageRef, file);
        finalLogoUrl = await getDownloadURL(storageRef);
        this.isUploadingLogo.set(false);
      }

      const data: any = {
        name: this.formName().trim(),
        active: this.formActive(),
        logoUrl: finalLogoUrl || null,
      };

      if (this.isEditing() && this.editingId()) {
        await this.firestore.updateDocument(`brands/${this.editingId()}`, data);
        this.toast.success('Brand updated successfully');
      } else {
        const newData = {
          ...data,
          tenantId: 1,
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: this.auth.getActionBy()
        };
        await this.firestore.addDocument('brands', newData);
        this.toast.success('Brand created successfully');
      }
      this.closeModal();
    } catch (err) {
      console.error('Error saving brand:', err);
      this.toast.error('Failed to save brand');
    } finally {
      this.isSaving.set(false);
      this.isUploadingLogo.set(false);
    }
  }

  confirmDelete(id: string) {
    this.deletingId.set(id);
  }

  cancelDelete() {
    this.deletingId.set(null);
  }

  async deleteBrand(id: string) {
    const count = this.getProductCount(id);
    if (count > 0) {
      this.toast.error(`Cannot delete — ${count} products are using this brand`);
      this.deletingId.set(null);
      return;
    }

    try {
      await this.firestore.softDelete(`brands/${id}`, this.auth.getActionBy()?.uid || 'unknown');
      this.toast.success('Brand deleted successfully');
    } catch (err) {
      console.error('Error deleting brand:', err);
      this.toast.error('Failed to delete brand');
    } finally {
      this.deletingId.set(null);
    }
  }
}
