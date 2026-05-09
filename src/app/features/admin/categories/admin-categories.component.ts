import { Component, inject, signal, computed, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { where, orderBy, serverTimestamp } from '@angular/fire/firestore';

interface Category {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
  tenantId: number;
  isDeleted: boolean;
}

interface Product {
  id: string;
  categoryId: string;
  tenantId: number;
  isDeleted: boolean;
}

@Component({
  selector: 'app-admin-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, StatusBadgeComponent],
  templateUrl: './admin-categories.component.html',
  styleUrl: './admin-categories.component.scss'
})
export class AdminCategoriesComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  categories = signal<Category[]>([]);
  products = signal<Product[]>([]);
  isLoading = signal(true);

  // Modal State
  showModal = signal(false);
  isEditing = signal(false);
  editingId = signal<string | null>(null);
  isSaving = signal(false);

  // Form State
  formName = signal('');
  formDisplayOrder = signal(1);
  formActive = signal(true);

  // Delete State
  deletingId = signal<string | null>(null);

  constructor() {
    this.loadData();
  }

  private loadData() {
    this.firestore.getCollection<Category>(
      'categories',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false),
      orderBy('displayOrder', 'asc')
    ).subscribe({
      next: (data) => {
        this.categories.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading categories:', err);
        this.toast.error('Failed to load categories');
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

  getProductCount(categoryId: string): number {
    return this.products().filter(p => p.categoryId === categoryId).length;
  }

  openAddModal() {
    const maxOrder = this.categories().reduce((max, cat) => Math.max(max, cat.displayOrder || 0), 0);
    this.formName.set('');
    this.formDisplayOrder.set(maxOrder + 1);
    this.formActive.set(true);
    this.isEditing.set(false);
    this.editingId.set(null);
    this.showModal.set(true);
  }

  openEditModal(category: Category) {
    this.formName.set(category.name);
    this.formDisplayOrder.set(category.displayOrder);
    this.formActive.set(category.active);
    this.isEditing.set(true);
    this.editingId.set(category.id);
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

  async saveCategory() {
    if (!this.formName().trim() || this.formDisplayOrder() == null) {
      this.toast.warning('Please fill in all required fields');
      return;
    }

    this.isSaving.set(true);
    
    try {
      const data = {
        name: this.formName().trim(),
        displayOrder: this.formDisplayOrder(),
        active: this.formActive(),
      };

      if (this.isEditing() && this.editingId()) {
        await this.firestore.updateDocument(`categories/${this.editingId()}`, data);
        this.toast.success('Category updated successfully');
      } else {
        const newData = {
          ...data,
          tenantId: 1,
          isDeleted: false,
          createdAt: serverTimestamp(),
          createdBy: this.auth.getActionBy()
        };
        await this.firestore.addDocument('categories', newData);
        this.toast.success('Category created successfully');
      }
      this.closeModal();
    } catch (err) {
      console.error('Error saving category:', err);
      this.toast.error('Failed to save category');
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

  async deleteCategory(id: string) {
    const count = this.getProductCount(id);
    if (count > 0) {
      this.toast.error(`Cannot delete — ${count} products are using this category`);
      this.deletingId.set(null);
      return;
    }

    try {
      await this.firestore.softDelete(`categories/${id}`, this.auth.getActionBy()?.uid || 'unknown');
      this.toast.success('Category deleted successfully');
    } catch (err) {
      console.error('Error deleting category:', err);
      this.toast.error('Failed to delete category');
    } finally {
      this.deletingId.set(null);
    }
  }
}
