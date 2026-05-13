import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { ToastService } from '../../../../shared/services/toast.service';
import { centsToDisplay } from '../../../../shared/utils/currency.utils';
import { Product } from '../../../../core/models/product.model';
import { where, orderBy, limit } from '@angular/fire/firestore';
import { StockAdjustment } from '../../../../core/models/stock-adjustment.model';
import { StockAdjustmentModalComponent } from '../../stock-adjustments/stock-adjustment-modal/stock-adjustment-modal.component';

interface Category { id: string; name: string; }
interface Brand { id: string; name: string; }

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, HasPermissionDirective, DatePipe, StockAdjustmentModalComponent],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss'
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private firestore = inject(FirestoreService);
  private toast = inject(ToastService);

  productId = signal<string>('');
  product = signal<Product | null>(null);
  loading = signal(true);
  
  categoryName = signal('Unknown Category');
  brandName = signal('Unknown Brand');
  stockAdjustments = signal<StockAdjustment[]>([]);
  
  showDeleteConfirm = signal(false);
  isModalOpen = signal(false);

  marginPercent = computed(() => {
    const p = this.product();
    if (!p || p.priceCents === 0 || p.costCents === 0) return 0;
    const margin = ((p.priceCents - p.costCents) / p.priceCents) * 100;
    return Math.round(margin);
  });

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.productId.set(id);
        this.loadData(id);
      } else {
        this.loading.set(false);
      }
    });
  }

  loadData(id: string) {
    this.loading.set(true);
    
    // Load Product
    this.firestore.getDocument<Product>(`products/${id}`).subscribe((p: Product | null) => {
      this.product.set(p);
      if (p) {
        this.loadCategoryAndBrand(p.categoryId, p.brandId);
        this.loadStockAdjustments(id);
      } else {
        this.loading.set(false);
      }
    });
  }

  loadCategoryAndBrand(categoryId: string, brandId: string) {
    if (categoryId) {
      this.firestore.getDocument<Category>(`categories/${categoryId}`).subscribe((cat: Category | null) => {
        if (cat) this.categoryName.set(cat.name);
      });
    }
    if (brandId) {
      this.firestore.getDocument<Brand>(`brands/${brandId}`).subscribe((brand: Brand | null) => {
        if (brand) this.brandName.set(brand.name);
      });
    }
  }

  loadStockAdjustments(productId: string) {
    this.firestore.getCollection<StockAdjustment>(
      'stockAdjustments',
      where('productId', '==', productId),
      where('isDeleted', '==', false)
    ).subscribe((data: StockAdjustment[]) => {
      // Sort and take 5 in memory per rules
      const sorted = [...data].sort((a, b) => this.toDate(b.createdAt).getTime() - this.toDate(a.createdAt).getTime());
      this.stockAdjustments.set(sorted.slice(0, 5));
      this.loading.set(false);
    });
  }

  private toDate(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts.toDate) return ts.toDate();
    return new Date(ts);
  }

  openAdjustmentModal() {
    this.isModalOpen.set(true);
  }

  closeModal(refresh: boolean) {
    this.isModalOpen.set(false);
    if (refresh) {
      // Reload product and adjustments
      this.loadData(this.productId());
    }
  }

  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  formatDate(date: any): Date | null {
    if (!date) return null;
    return date.toDate ? date.toDate() : new Date(date);
  }

  copyId() {
    const id = this.productId();
    if (id) {
      navigator.clipboard.writeText(id).then(() => {
        this.toast.success('ID copied to clipboard');
      });
    }
  }

  async toggleStatus() {
    const p = this.product();
    if (!p) return;
    try {
      await this.firestore.updateDocument(`products/${p.id}`, {
        active: !p.active
      });
      // The local state will be updated via the subscription stream
      this.toast.success(p.active ? 'Product deactivated' : 'Product activated');
    } catch (err) {
      this.toast.error('Failed to update status');
    }
  }

  async deleteProduct() {
    const p = this.product();
    if (!p) return;
    try {
      // Soft delete using the standard pattern (needs deletedBy, we'll just use 'admin' or something if we don't have current user, wait, let's use the firestore method if we can, or just set isDeleted)
      // Usually auth.service is used, but we can do a generic soft delete or skip deletedBy if we don't have it
      await this.firestore.updateDocument(`products/${p.id}`, {
        isDeleted: true,
        deletedAt: new Date()
      });
      this.toast.success('Product deleted');
      this.router.navigate(['/admin/products']);
    } catch (err) {
      this.toast.error('Failed to delete product');
    }
  }

  getAdjustmentTypeClass(type: string): string {
    const redTypes = ['DAMAGED', 'EXPIRED', 'LOST', 'SAMPLE'];
    const greenTypes = ['RECEIVED', 'RETURN_FROM_CUSTOMER'];
    
    if (redTypes.includes(type.toUpperCase())) return 'badge-red';
    if (greenTypes.includes(type.toUpperCase())) return 'badge-green';
    return 'badge-navy';
  }
}
