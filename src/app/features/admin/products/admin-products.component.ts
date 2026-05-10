import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { centsToDisplay } from '../../../shared/utils/currency.utils';
import { where } from '@angular/fire/firestore';
import { Product } from '../../../core/models/product.model';

interface Category {
  id: string;
  name: string;
  tenantId: number;
  isDeleted: boolean;
}

interface Brand {
  id: string;
  name: string;
  tenantId: number;
  isDeleted: boolean;
}

type SortColumn = 'name' | 'price' | 'stock';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StatusBadgeComponent, HasPermissionDirective],
  template: `
    <div class="page-header">
      <div class="title-group">
        <h1>Products</h1>
        <p class="subtitle">Manage your product catalog</p>
      </div>
      
      <div class="actions">
        <div class="view-toggles">
          <button [class.active]="viewMode() === 'grid'" (click)="setViewMode('grid')" title="Grid View">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          </button>
          <button [class.active]="viewMode() === 'table'" (click)="setViewMode('table')" title="Table View">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          </button>
        </div>
        
        <button class="btn-primary" routerLink="/admin/products/add">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Add Product
        </button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="search-wrapper">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)" placeholder="Search by name, SKU or barcode...">
      </div>
      
      <select class="filter-select" [ngModel]="categoryFilter()" (ngModelChange)="categoryFilter.set($event)">
        <option value="all">All Categories</option>
        @for (cat of categories(); track cat.id) {
          <option [value]="cat.id">{{ cat.name }}</option>
        }
      </select>
      
      <select class="filter-select" [ngModel]="brandFilter()" (ngModelChange)="brandFilter.set($event)">
        <option value="all">All Brands</option>
        @for (brand of brands(); track brand.id) {
          <option [value]="brand.id">{{ brand.name }}</option>
        }
      </select>
      
      <select class="filter-select" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
        <option value="all">All Status</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>

      <select class="filter-select" [ngModel]="stockFilter()" (ngModelChange)="stockFilter.set($event)">
        <option value="all">All Stock</option>
        <option value="low">Low Stock</option>
        <option value="out">Out of Stock</option>
      </select>
    </div>

    @if (isLoading()) {
      <div [class]="viewMode() === 'grid' ? 'product-grid' : 'product-list'">
        @for (i of [1,2,3,4,5,6,7,8]; track i) {
          <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-body">
              <div class="skeleton-line w-75"></div>
              <div class="skeleton-line w-50"></div>
              <div class="skeleton-line w-25"></div>
            </div>
          </div>
        }
      </div>
    } @else {
      @if (filteredProducts().length === 0) {
        <div class="empty-state">
          <div class="empty-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          </div>
          <h3>No products found</h3>
          <p>
            @if (hasActiveFilters()) {
              Try adjusting your filters or search query.
            } @else {
              Add your first product to the catalog.
            }
          </p>
          @if (!hasActiveFilters()) {
            <button class="btn-primary" routerLink="/admin/products/add">Add Product</button>
          }
        </div>
      } @else {
        @if (viewMode() === 'grid') {
          <div class="product-grid">
            @for (product of filteredProducts(); track product.id) {
              <div class="product-card" (click)="goToDetails(product.id)" style="cursor: pointer;">
                <div class="card-image-wrapper">
                  <div class="category-pill">{{ getCategoryName(product.categoryId) }}</div>
                  
                  @if (product.imageUrl) {
                    <img [src]="product.imageUrl" [alt]="product.name">
                  } @else {
                    <div class="placeholder-image">
                      <div class="circle">{{ product.name.charAt(0).toUpperCase() }}</div>
                    </div>
                  }
                  
                  @if (product.stock <= product.lowStockThreshold) {
                    <app-status-badge class="stock-badge"
                      [status]="product.stock === 0 ? 'out_of_stock' : 'low_stock'">
                    </app-status-badge>
                  }
                </div>
                
                <div class="card-body">
                  <div class="row-1">
                    <h3 class="product-name" [title]="product.name" [class.inactive]="!product.active">{{ product.name }}</h3>
                    <label class="compact-toggle" (click)="$event.stopPropagation()">
                      <input type="checkbox" [ngModel]="product.active" (ngModelChange)="toggleStatus(product)">
                      <span class="slider"></span>
                    </label>
                  </div>
                  
                  <div class="row-2">
                    <span class="product-brand">{{ getBrandName(product.brandId) }}</span>
                    <span class="dot">•</span>
                    <span class="product-measurement">{{ product.measurement.quantity }} {{ product.measurement.unit }}</span>
                  </div>
                  
                  <div class="row-3">
                    <span class="product-sku">{{ product.sku }}</span>
                    <span class="stock-pill" [ngClass]="getStockClass(product)">
                      {{ product.stock === 0 ? 'Out of stock' : product.stock <= product.lowStockThreshold ? 'Low stock' : 'In stock' }}
                    </span>
                  </div>
                </div>
                
                <div class="card-footer">
                  <div class="price-col">
                    <div class="price">{{ formatCurrency(product.priceCents) }}</div>
                    <div class="cost" *appHasPermission="'editProducts'">{{ formatCurrency(product.costCents) }}</div>
                  </div>
                  <button class="edit-btn" (click)="$event.stopPropagation()" [routerLink]="['/admin/products', product.id, 'edit']">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Edit
                  </button>
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="table-card">
            <div class="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Image</th>
                    <th class="sortable" (click)="toggleSort('name')">
                      Name & SKU
                      @if (sortCol() === 'name') {
                        <span class="sort-indicator">{{ sortDir() === 'asc' ? '↑' : '↓' }}</span>
                      }
                    </th>
                    <th>Brand</th>
                    <th>Category</th>
                    <th>Measurement</th>
                    <th class="sortable" (click)="toggleSort('price')">
                      Price
                      @if (sortCol() === 'price') {
                        <span class="sort-indicator">{{ sortDir() === 'asc' ? '↑' : '↓' }}</span>
                      }
                    </th>
                    <th *appHasPermission="'editProducts'">Cost</th>
                    <th class="sortable" (click)="toggleSort('stock')">
                      Stock
                      @if (sortCol() === 'stock') {
                        <span class="sort-indicator">{{ sortDir() === 'asc' ? '↑' : '↓' }}</span>
                      }
                    </th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (product of filteredProducts(); track product.id) {
                    <tr [class.inactive-row]="!product.active" (click)="goToDetails(product.id)" style="cursor: pointer;">
                      <td>
                        @if (product.imageUrl) {
                          <img [src]="product.imageUrl" [alt]="product.name" class="table-image">
                        } @else {
                          <div class="table-placeholder">{{ product.name.charAt(0).toUpperCase() }}</div>
                        }
                      </td>
                      <td class="name-sku">
                        <div class="name">{{ product.name }}</div>
                        <div class="sku">{{ product.sku }}</div>
                      </td>
                      <td>{{ getBrandName(product.brandId) }}</td>
                      <td>{{ getCategoryName(product.categoryId) }}</td>
                      <td>{{ product.measurement.quantity }} {{ product.measurement.unit }}</td>
                      <td class="price-col">
                        <div class="price">{{ formatCurrency(product.priceCents) }}</div>
                      </td>
                      <td class="price-col" *appHasPermission="'editProducts'">
                        <div class="cost">{{ formatCurrency(product.costCents) }}</div>
                      </td>
                      <td>
                        <span class="stock-count" [ngClass]="getStockClass(product)">
                          {{ product.stock }}
                        </span>
                      </td>
                      <td>
                        @if (product.active) {
                          <app-status-badge status="active"></app-status-badge>
                        } @else {
                          <app-status-badge status="inactive"></app-status-badge>
                        }
                      </td>
                      <td>
                        <div class="actions-cell">
                          <button class="action-btn" (click)="$event.stopPropagation()" [routerLink]="['/admin/products', product.id, 'edit']" title="Edit">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          </button>
                          <button class="action-btn" (click)="$event.stopPropagation(); toggleStatus(product)" [title]="product.active ? 'Deactivate' : 'Activate'">
                            @if (product.active) {
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            } @else {
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      }
    }
  `,
  styleUrl: './admin-products.component.scss'
})
export class AdminProductsComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly router = inject(Router);
  
  viewMode = signal<'grid' | 'table'>('grid');
  
  products = signal<Product[]>([]);
  categories = signal<Category[]>([]);
  brands = signal<Brand[]>([]);
  isLoading = signal(true);

  // Filters
  searchQuery = signal('');
  categoryFilter = signal('all');
  brandFilter = signal('all');
  statusFilter = signal('all');
  stockFilter = signal('all');

  // Sorting
  sortCol = signal<SortColumn>('name');
  sortDir = signal<SortDirection>('asc');

  hasActiveFilters = computed(() => {
    return this.searchQuery().trim() !== '' ||
           this.categoryFilter() !== 'all' ||
           this.brandFilter() !== 'all' ||
           this.statusFilter() !== 'all' ||
           this.stockFilter() !== 'all';
  });

  filteredProducts = computed(() => {
    let result = this.products();
    const query = this.searchQuery().trim().toLowerCase();
    const catId = this.categoryFilter();
    const brandId = this.brandFilter();
    const status = this.statusFilter();
    const stock = this.stockFilter();

    if (query) {
      result = result.filter(p => 
        p.name.toLowerCase().includes(query) || 
        p.sku.toLowerCase().includes(query) || 
        (p.barcode && p.barcode.toLowerCase().includes(query))
      );
    }
    
    if (catId !== 'all') {
      result = result.filter(p => p.categoryId === catId);
    }
    
    if (brandId !== 'all') {
      result = result.filter(p => p.brandId === brandId);
    }
    
    if (status !== 'all') {
      result = result.filter(p => p.active === (status === 'active'));
    }
    
    if (stock !== 'all') {
      if (stock === 'low') {
        result = result.filter(p => p.stock > 0 && p.stock <= p.lowStockThreshold);
      } else if (stock === 'out') {
        result = result.filter(p => p.stock === 0);
      }
    }

    // Sort
    const col = this.sortCol();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    
    return [...result].sort((a, b) => {
      let valA, valB;
      if (col === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (col === 'price') {
        valA = a.priceCents;
        valB = b.priceCents;
      } else if (col === 'stock') {
        valA = a.stock;
        valB = b.stock;
      } else {
        return 0;
      }
      
      if (valA < valB) return -1 * dir;
      if (valA > valB) return 1 * dir;
      return 0;
    });
  });

  constructor() {
    const savedView = localStorage.getItem('tropx_products_view');
    if (savedView === 'table' || savedView === 'grid') {
      this.viewMode.set(savedView);
    }
    this.loadData();
  }

  private loadData() {
    // Products
    this.firestore.getCollection<Product>(
      'products',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    ).subscribe({
      next: (data) => {
        this.products.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load products:', err);
        this.isLoading.set(false);
      }
    });

    // Categories
    this.firestore.getCollection<Category>(
      'categories',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    ).subscribe(data => this.categories.set(data));

    // Brands
    this.firestore.getCollection<Brand>(
      'brands',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    ).subscribe(data => this.brands.set(data));
  }

  setViewMode(mode: 'grid' | 'table') {
    this.viewMode.set(mode);
    localStorage.setItem('tropx_products_view', mode);
  }

  toggleSort(col: SortColumn) {
    if (this.sortCol() === col) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortCol.set(col);
      this.sortDir.set('asc');
    }
  }

  getCategoryName(id: string): string {
    const cat = this.categories().find(c => c.id === id);
    return cat ? cat.name : 'Unknown Category';
  }

  getBrandName(id: string): string {
    const brand = this.brands().find(b => b.id === id);
    return brand ? brand.name : 'Unknown Brand';
  }

  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  getStockClass(product: Product): string {
    if (product.stock === 0) return 'out-of-stock';
    if (product.stock <= product.lowStockThreshold) return 'low-stock';
    return 'in-stock';
  }

  async toggleStatus(product: Product) {
    try {
      await this.firestore.updateDocument(`products/${product.id}`, {
        active: !product.active
      });
    } catch (e) {
      console.error('Failed to update product status', e);
    }
  }

  goToDetails(productId: string) {
    this.router.navigate(['/admin/products', productId]);
  }
}
