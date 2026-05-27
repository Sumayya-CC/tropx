import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { PortalService } from '../../../core/services/portal.service';
import { ToastService } from '../../../shared/services/toast.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { where } from '@angular/fire/firestore';

@Component({
  selector: 'app-portal-product-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './portal-product-detail.component.html',
  styleUrl: './portal-product-detail.component.scss'
})
export class PortalProductDetailComponent implements OnInit {
  protected readonly portal = inject(PortalService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly firestoreService = inject(FirestoreService);

  productId = signal<string>('');
  product = signal<any>(null);
  isLoading = signal(true);
  quantity = signal(1);

  // Related products (same category)
  relatedProducts = computed(() => {
    const p = this.product();
    if (!p) return [];
    return this.portal.allProducts()
      .filter((x: any) =>
        x.id !== p.id &&
        x.categoryId === p.categoryId &&
        x.stock > 0
      )
      .slice(0, 4);
  });

  cartQty = computed(() =>
    this.portal.cartItems()
      .find(i => i.productId === this.productId())
      ?.quantity ?? 0
  );

  isInCart = computed(() =>
    this.portal.cartItems()
      .some(i => i.productId === this.productId())
  );

  stockStatus = computed(() => {
    const p = this.product();
    if (!p) return { label: '', class: '' };
    if (p.stock <= 0) {
      return { label: 'Out of Stock', class: 'out' };
    }
    if (p.stock <= (p.lowStockThreshold || 5)) {
      return {
        label: `Only ${p.stock} units left`,
        class: 'low'
      };
    }
    return {
      label: `In Stock (${p.stock} available)`,
      class: 'in'
    };
  });

  marginPercent = computed(() => 0);
  // Portal never shows margin

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/portal/catalog']);
      return;
    }
    this.productId.set(id);

    // Try to find in already-loaded products first
    const cached = this.portal.allProducts()
      .find((p: any) => p.id === id);
    if (cached) {
      this.product.set(cached);
      this.isLoading.set(false);
      // Set initial quantity
      const cartItem = this.portal.cartItems()
        .find(i => i.productId === id);
      if (cartItem) {
        this.quantity.set(cartItem.quantity);
      }
    } else {
      // Load from Firestore directly
      this.firestoreService
        .getDocument<any>(`products/${id}`)
        .subscribe(p => {
          if (!p || p.isDeleted || !p.active) {
            this.toast.error('Product not found');
            this.router.navigate(['/portal/catalog']);
            return;
          }
          this.product.set(p);
          this.isLoading.set(false);
        });
    }
  }

  incrementQty() {
    const p = this.product();
    if (!p) return;
    const max = p.stock;
    if (this.quantity() < max) {
      this.quantity.update(q => q + 1);
    }
  }

  decrementQty() {
    if (this.quantity() > 1) {
      this.quantity.update(q => q - 1);
    }
  }

  addToCart() {
    const p = this.product();
    if (!p || p.stock <= 0) return;
    this.portal.addToCart(p, this.quantity());
    this.toast.success(
      `${p.name} added to cart`
    );
  }

  updateCartQty(qty: number) {
    if (qty <= 0) {
      this.portal.removeFromCart(this.productId());
    } else {
      this.portal.updateCartQty(
        this.productId(), qty
      );
    }
  }

  removeFromCart() {
    this.portal.removeFromCart(this.productId());
    this.toast.success('Removed from cart');
  }

  formatCurrency(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }

  getProductInitial(name: string): string {
    return (name || '?').charAt(0).toUpperCase();
  }
}
