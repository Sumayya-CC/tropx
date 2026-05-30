import { Component, computed, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { PortalService } from '../../../core/services/portal.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ToastService } from '../../../shared/services/toast.service';

@Component({
  selector: 'app-portal-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './portal-catalog.component.html',
  styleUrl: './portal-catalog.component.scss'
})
export class PortalCatalogComponent {
  protected readonly portal = inject(PortalService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  searchQuery = signal('');
  selectedCategory = signal<string>('all');
  sortBy = signal<'name' | 'price_asc' | 'price_desc'>('name');
  viewMode = signal<'grid' | 'list'>('grid');

  // Load categories dynamically from Firestore
  private categories$ = this.firestore
    .getCollection<{ id: string; name: string }>(
      'categories',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    );

  categories = toSignal(this.categories$,
    { initialValue: [] as { id: string; name: string }[] }
  );

  // Quantity inputs per product (for cart stepper)
  qtyInputs = signal<Record<string, number>>({});

  filteredProducts = computed(() => {
    let list = this.portal.allProducts()
      .filter(p => !p.isDeleted && p.active);

    // Search
    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
      );
    }

    // Category filter
    const cat = this.selectedCategory();
    if (cat !== 'all') {
      list = list.filter(p => p.categoryId === cat);
    }

    // Sort
    const sort = this.sortBy();
    if (sort === 'name') {
      list = [...list].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
      );
    } else if (sort === 'price_asc') {
      list = [...list].sort((a, b) =>
        (a.priceCents || 0) - (b.priceCents || 0)
      );
    } else if (sort === 'price_desc') {
      list = [...list].sort((a, b) =>
        (b.priceCents || 0) - (a.priceCents || 0)
      );
    }

    return list;
  });

  inStockCount = computed(() =>
    this.filteredProducts()
      .filter(p => p.stock > (p.lowStockThreshold || 5))
      .length
  );

  getCartQty(productId: string): number {
    return this.portal.cartItems()
      .find(i => i.productId === productId)
      ?.quantity ?? 0;
  }

  isInCart(productId: string): boolean {
    return this.portal.cartItems()
      .some(i => i.productId === productId);
  }

  getQty(productId: string): number {
    return this.qtyInputs()[productId] || 1;
  }

  setQty(productId: string, qty: number) {
    const product = this.filteredProducts()
      .find(p => p.id === productId);
    const maxStock = product?.stock || 999;
    const clamped = Math.max(1,
      Math.min(qty, maxStock));
    this.qtyInputs.update(q => ({
      ...q,
      [productId]: clamped
    }));
  }

  showQtyDropdown = signal<string | null>(null);

  quickQtys = [5, 10, 20, 30, 50, 100];

  toggleQtyDropdown(productId: string) {
    this.showQtyDropdown.update(current =>
      current === productId ? null : productId
    );
  }

  selectQuickQty(productId: string, qty: number) {
    this.setQty(productId, qty);
    this.showQtyDropdown.set(null);
  }

  hasQuickQtys(product: any): boolean {
    return this.quickQtys.some(q => q <= product.stock);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.qty-picker-wrap')) {
      this.showQtyDropdown.set(null);
    }
  }

  addToCart(product: any) {
    if (product.stock <= 0) return;
    const qty = this.getQty(product.id);
    this.portal.addToCart(product, qty);
    this.showQtyDropdown.set(null);
    // Reset qty input after adding
    this.qtyInputs.update(q => ({
      ...q,
      [product.id]: 1
    }));
    this.toast.success(
      `${product.name} ×${qty} added to cart`
    );
  }

  increment(product: any) {
    const current = this.getCartQty(product.id);
    if (current >= product.stock) return;
    this.portal.updateCartQty(product.id, current + 1);
  }

  decrement(product: any) {
    const current = this.getCartQty(product.id);
    if (current <= 1) {
      this.portal.removeFromCart(product.id);
    } else {
      this.portal.updateCartQty(product.id, current - 1);
    }
  }

  getStockStatus(product: any): {
    label: string;
    class: string;
  } {
    if (product.stock <= 0) {
      return { label: 'Out of Stock', class: 'out' };
    }
    if (product.stock <= (product.lowStockThreshold || 5)) {
      return {
        label: `Only ${product.stock} left`,
        class: 'low'
      };
    }
    return { label: 'In Stock', class: 'in' };
  }

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }

  getProductInitial(name: string): string {
    return (name || '?').charAt(0).toUpperCase();
  }

  clearSearch() {
    this.searchQuery.set('');
  }
}
