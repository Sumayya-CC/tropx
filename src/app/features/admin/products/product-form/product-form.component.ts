import { Component, inject, signal, computed, effect, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Storage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { centsToDisplay, displayToCents } from '../../../../shared/utils/currency.utils';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { serverTimestamp, where } from '@angular/fire/firestore';
import { Product, ProductUnit } from '../../../../core/models/product.model';

interface Category {
  id: string;
  name: string;
}

interface Brand {
  id: string;
  name: string;
}

const PRODUCT_UNITS: ProductUnit[] = ['mL', 'L', 'g', 'kg', 'pcs', 'packets', 'boxes', 'bottles', 'cans', 'bags', 'other'];

declare var window: any;

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HasPermissionDirective, LoadingSpinnerComponent],
  template: `
    <div class="page-header">
      <div class="left-group">
        <button class="back-btn" routerLink="/admin/products">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          &nbsp; Products
        </button>
        <h1>{{ isEditMode() ? 'Edit Product' : 'Add Product' }}</h1>
      </div>
      <div class="actions">
        @if (isEditMode()) {
          <button class="btn-danger" (click)="deleteProduct()" [disabled]="isSaving()">Delete Product</button>
        }
        <button class="btn-primary" (click)="saveProduct()" [disabled]="isSaving()">
          @if (isSaving()) {
            <app-loading-spinner size="sm" color="#fff"></app-loading-spinner>
            Saving...
          } @else {
            Save Product
          }
        </button>
      </div>
    </div>

    <div class="form-layout">
      <!-- LEFT COLUMN -->
      <div class="left-col">
        
        <!-- Basic Information -->
        <div class="form-section">
          <h2>Basic Information</h2>
          <div class="form-group">
            <label>Product Name <span class="required">*</span></label>
            <input type="text" [(ngModel)]="name" placeholder="e.g. Lays Classic Chips">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea [(ngModel)]="description" placeholder="Brief product description" rows="3"></textarea>
          </div>
          <div class="row">
            <div class="col form-group">
              <label>Category <span class="required">*</span></label>
              <select [(ngModel)]="categoryId">
                <option value="">Select Category</option>
                @for (cat of categories(); track cat.id) {
                  <option [value]="cat.id">{{ cat.name }}</option>
                }
              </select>
            </div>
            <div class="col form-group">
              <label>Brand <span class="required">*</span></label>
              <select [(ngModel)]="brandId">
                <option value="">Select Brand</option>
                @for (brand of brands(); track brand.id) {
                  <option [value]="brand.id">{{ brand.name }}</option>
                }
              </select>
            </div>
          </div>
        </div>

        <!-- Identification -->
        <div class="form-section">
          <h2>Identification</h2>
          <div class="form-group">
            <label>SKU <span class="required">*</span></label>
            <input type="text" [(ngModel)]="sku" (blur)="checkSkuUniqueness()" placeholder="e.g. LAY-CLASS-40G">
            @if (skuError()) {
              <span class="error-text">SKU already exists</span>
            } @else if (skuValid()) {
              <span class="helper-text" style="color: #10b981;">✓ SKU is available</span>
            }
          </div>
          <div class="form-group">
            <label>Barcode</label>
            <div class="input-with-action">
              <input type="text" [(ngModel)]="barcode" placeholder="Scan or enter barcode">
              <button (click)="startScan()">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><rect x="7" y="7" width="10" height="10"></rect></svg>
                Scan
              </button>
            </div>
          </div>
        </div>

        <!-- Measurement -->
        <div class="form-section">
          <h2>Measurement</h2>
          <div class="row">
            <div class="col form-group">
              <label>Quantity <span class="required">*</span></label>
              <input type="number" [(ngModel)]="measurementQuantity" placeholder="e.g. 150" min="0.01" step="0.01">
            </div>
            <div class="col form-group">
              <label>Unit <span class="required">*</span></label>
              <select [(ngModel)]="measurementUnit">
                @for (unit of availableUnits; track unit) {
                  <option [value]="unit">{{ unit }}</option>
                }
              </select>
            </div>
          </div>
          <div class="form-group">
            <span class="helper-text">Preview: {{ measurementQuantity() || 0 }} {{ measurementUnit() }}</span>
          </div>
        </div>
      </div>

      <!-- RIGHT COLUMN -->
      <div class="right-col">
        
        <!-- Pricing -->
        <div class="form-section">
          <h2>Pricing</h2>
          <div class="form-group">
            <label>Selling Price (CAD) <span class="required">*</span></label>
            <div class="input-prefix">
              <span class="prefix">$</span>
              <input type="text" [(ngModel)]="displayPrice" placeholder="0.00" (blur)="formatPriceInput()">
            </div>
          </div>
          
          <div class="form-group" *appHasPermission="'editProducts'">
            <label>Cost Price (CAD) <span class="required">*</span></label>
            <div class="input-prefix">
              <span class="prefix">$</span>
              <input type="text" [(ngModel)]="displayCost" placeholder="0.00" (blur)="formatCostInput()">
            </div>
            
            @if (displayPrice() && displayCost()) {
              <div class="margin-preview" [ngClass]="marginClass()">
                {{ marginPreview() }}
              </div>
            }
          </div>
        </div>

        <!-- Inventory -->
        <div class="form-section">
          <h2>Inventory</h2>
          <div class="form-group">
            <label>Stock Quantity <span class="required">*</span></label>
            <input type="number" [(ngModel)]="stock" placeholder="0" min="0" [disabled]="isEditMode()">
            @if (isEditMode()) {
              <span class="helper-text">Use Stock Adjustments to change stock levels</span>
            } @else {
              <span class="helper-text">Stock is adjusted via Stock Adjustments after initial setup</span>
            }
          </div>
          <div class="form-group">
            <label>Low Stock Threshold <span class="required">*</span></label>
            <input type="number" [(ngModel)]="lowStockThreshold" placeholder="10" min="0">
            <span class="helper-text">Alert when stock falls below this number</span>
          </div>
        </div>

        <!-- Image -->
        <div class="form-section">
          <h2>Product Image</h2>
          <div class="image-upload-area" [class.has-image]="!!previewImageUrl()" (click)="triggerFileInput()">
            @if (previewImageUrl()) {
              <img [src]="previewImageUrl()" alt="Product Image Preview">
              <button class="remove-btn" (click)="removeImage($event)" title="Remove Image">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            } @else {
              <div class="upload-content">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <span class="primary-text">Click to upload image</span>
                <span class="secondary-text">PNG, JPG up to 5MB</span>
              </div>
            }
            <input type="file" #fileInput style="display: none" accept="image/png, image/jpeg" (change)="onFileSelected($event)">
          </div>
          
          @if (uploadProgress() > 0 && uploadProgress() < 100) {
            <div class="upload-progress">
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" [style.width.%]="uploadProgress()"></div>
              </div>
              <span class="progress-text">{{ uploadProgress() | number:'1.0-0' }}% Uploading...</span>
            </div>
          }
        </div>

        <!-- Status -->
        <div class="form-section">
          <h2>Status</h2>
          <div class="form-group">
            <div class="toggle-group">
              <div class="toggle-label">
                <span class="toggle-title">Active Product</span>
                <span class="toggle-desc">{{ active() ? 'Visible to customers in catalog' : 'Hidden from customer catalog' }}</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" [(ngModel)]="active">
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Scanner Modal -->
    @if (isScanning()) {
      <div class="scanner-modal">
        <div class="scanner-content">
          <h3>Scan Barcode</h3>
          <div class="video-wrapper">
            <video #scannerVideo autoplay playsinline></video>
            <div class="scanner-overlay">
              <div class="scan-area"></div>
            </div>
          </div>
          <button (click)="stopScan()">Cancel Scan</button>
        </div>
      </div>
    }
  `,
  styleUrl: './product-form.component.scss'
})
export class ProductFormComponent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(Storage);

  isEditMode = signal(false);
  productId = signal<string | null>(null);
  isSaving = signal(false);
  originalSku = signal('');

  categories = signal<Category[]>([]);
  brands = signal<Brand[]>([]);
  availableUnits = PRODUCT_UNITS;

  // Form Fields
  name = signal('');
  description = signal('');
  categoryId = signal('');
  brandId = signal('');
  sku = signal('');
  barcode = signal('');
  measurementQuantity = signal<number | null>(null);
  measurementUnit = signal<ProductUnit>('pcs');
  
  displayPrice = signal('');
  displayCost = signal('');

  stock = signal<number>(0);
  lowStockThreshold = signal<number>(10);
  active = signal(true);

  // Validation state
  skuError = signal(false);
  skuValid = signal(false);

  // Image Upload
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  selectedFile = signal<File | null>(null);
  previewImageUrl = signal<string | null>(null);
  existingImageUrl = signal<string | null>(null);
  uploadProgress = signal(0);

  // Scanner
  @ViewChild('scannerVideo') scannerVideo?: ElementRef<HTMLVideoElement>;
  isScanning = signal(false);
  private scanStream: MediaStream | null = null;
  private scanInterval: any = null;

  marginPreview = computed(() => {
    const priceCents = displayToCents(this.displayPrice() || 0);
    const costCents = displayToCents(this.displayCost() || 0);
    if (priceCents <= 0) return '0.0% margin';
    const margin = ((priceCents - costCents) / priceCents) * 100;
    return margin.toFixed(1) + '% margin';
  });

  marginClass = computed(() => {
    const priceCents = displayToCents(this.displayPrice() || 0);
    const costCents = displayToCents(this.displayCost() || 0);
    if (priceCents <= 0) return 'bad';
    const margin = ((priceCents - costCents) / priceCents) * 100;
    if (margin > 20) return 'good';
    if (margin >= 10) return 'ok';
    return 'bad';
  });

  constructor() {
    this.loadDropdowns();
    
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode.set(true);
      this.productId.set(id);
      this.loadProduct(id);
    }
  }

  ngOnDestroy() {
    this.stopScan();
  }

  private async loadDropdowns() {
    this.firestore.getCollection<Category>('categories', where('tenantId', '==', 1), where('isDeleted', '==', false))
      .subscribe(data => this.categories.set(data));
      
    this.firestore.getCollection<Brand>('brands', where('tenantId', '==', 1), where('isDeleted', '==', false))
      .subscribe(data => this.brands.set(data));
  }

  private async loadProduct(id: string) {
    this.firestore.getDocument<Product>(`products/${id}`).subscribe(product => {
      if (!product || product.isDeleted) {
        this.toast.error('Product not found');
        this.router.navigate(['/admin/products']);
        return;
      }

      this.name.set(product.name);
      this.description.set(product.description || '');
      this.categoryId.set(product.categoryId);
      this.brandId.set(product.brandId);
      this.sku.set(product.sku);
      this.originalSku.set(product.sku);
      this.barcode.set(product.barcode || '');
      this.measurementQuantity.set(product.measurement.quantity);
      this.measurementUnit.set(product.measurement.unit);
      
      this.displayPrice.set((product.priceCents / 100).toFixed(2));
      this.displayCost.set((product.costCents / 100).toFixed(2));
      
      this.stock.set(product.stock);
      this.lowStockThreshold.set(product.lowStockThreshold);
      this.active.set(product.active);
      this.existingImageUrl.set(product.imageUrl || null);
      this.previewImageUrl.set(product.imageUrl || null);
    });
  }

  formatPriceInput() {
    if (!this.displayPrice()) return;
    const val = displayToCents(this.displayPrice());
    this.displayPrice.set((val / 100).toFixed(2));
  }

  formatCostInput() {
    if (!this.displayCost()) return;
    const val = displayToCents(this.displayCost());
    this.displayCost.set((val / 100).toFixed(2));
  }

  async checkSkuUniqueness() {
    const currentSku = this.sku().trim();
    if (!currentSku) {
      this.skuError.set(false);
      this.skuValid.set(false);
      return;
    }

    if (this.isEditMode() && currentSku === this.originalSku()) {
      this.skuError.set(false);
      this.skuValid.set(true);
      return;
    }

    this.firestore.getCollection<Product>('products', where('sku', '==', currentSku), where('tenantId', '==', 1)).subscribe(data => {
      const exists = data.some(p => p.id !== this.productId());
      this.skuError.set(exists);
      this.skuValid.set(!exists);
    });
  }

  // --- Image Upload ---
  triggerFileInput() {
    if (this.previewImageUrl() && !this.selectedFile()) return; // Don't trigger if existing image
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: any) {
    const file = event.target.files?.[0] as File;
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      this.toast.error('Image size must be less than 5MB');
      return;
    }

    this.selectedFile.set(file);
    const reader = new FileReader();
    reader.onload = e => this.previewImageUrl.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  removeImage(event: Event) {
    event.stopPropagation();
    this.selectedFile.set(null);
    this.previewImageUrl.set(null);
    this.fileInput.nativeElement.value = '';
  }

  private async uploadImage(docId: string): Promise<string | null> {
    const file = this.selectedFile();
    if (!file) return this.previewImageUrl() ? this.existingImageUrl() : ''; // return existing or empty
    
    const ext = file.name.split('.').pop();
    const filePath = `products/${docId}/image.${ext}`;
    const storageRef = ref(this.storage, filePath);
    
    return new Promise((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, file);
      
      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          this.uploadProgress.set(progress);
        },
        (error) => reject(error),
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(url);
        }
      );
    });
  }

  // --- Scanner ---
  async startScan() {
    if (!('BarcodeDetector' in window)) {
      this.toast.error('Barcode scanning not supported on this browser. Please enter manually.');
      return;
    }

    try {
      this.scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      this.isScanning.set(true);
      
      setTimeout(() => {
        if (this.scannerVideo?.nativeElement) {
          const video = this.scannerVideo.nativeElement;
          video.srcObject = this.scanStream;
          
          const barcodeDetector = new window.BarcodeDetector();
          this.scanInterval = setInterval(async () => {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
              try {
                const barcodes = await barcodeDetector.detect(video);
                if (barcodes.length > 0) {
                  this.barcode.set(barcodes[0].rawValue);
                  this.toast.success('Barcode scanned successfully!');
                  this.stopScan();
                }
              } catch (e) {
                console.error('Barcode detection error', e);
              }
            }
          }, 300);
        }
      }, 100);
    } catch (e) {
      console.error('Failed to start scanner', e);
      this.toast.error('Could not access camera. Please enter barcode manually.');
    }
  }

  stopScan() {
    this.isScanning.set(false);
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.scanStream) {
      this.scanStream.getTracks().forEach(track => track.stop());
      this.scanStream = null;
    }
  }

  // --- Save / Delete ---
  async saveProduct() {
    if (!this.name().trim() || !this.categoryId() || !this.brandId() || !this.sku().trim() || !this.measurementQuantity() || !this.displayPrice() || !this.displayCost()) {
      this.toast.warning('Please fill in all required fields');
      return;
    }
    if (this.skuError()) {
      this.toast.error('Please fix SKU errors before saving');
      return;
    }

    this.isSaving.set(true);
    try {
      let finalDocId = this.productId();

      const productData: Partial<Product> = {
        name: this.name().trim(),
        description: this.description().trim(),
        categoryId: this.categoryId(),
        brandId: this.brandId(),
        sku: this.sku().trim(),
        barcode: this.barcode().trim(),
        measurement: {
          quantity: this.measurementQuantity()!,
          unit: this.measurementUnit()
        },
        priceCents: displayToCents(this.displayPrice()),
        costCents: displayToCents(this.displayCost()),
        currencyCode: 'CAD',
        lowStockThreshold: this.lowStockThreshold(),
        active: this.active(),
        tenantId: 1,
        isDeleted: false,
        updatedAt: serverTimestamp() as any,
      };

      if (this.isEditMode()) {
        await this.firestore.updateDocument(`products/${this.productId()}`, productData);
        finalDocId = this.productId();
        this.toast.success('Product updated successfully');
      } else {
        productData.stock = this.stock();
        productData.createdAt = serverTimestamp() as any;
        productData.createdBy = this.auth.getActionBy() as any;
        const tempRef = await this.firestore.addDocument('products', productData);
        finalDocId = tempRef.id;
        this.toast.success('Product added successfully');
      }

      // Handle Image Upload after we have a document ID
      try {
        if (this.selectedFile()) {
          const uploadedUrl = await this.uploadImage(finalDocId as string);
          if (uploadedUrl) {
            await this.firestore.updateDocument(`products/${finalDocId}`, { imageUrl: uploadedUrl });
          }
        } else if (!this.previewImageUrl() && this.existingImageUrl()) {
          // Image was removed
          await this.firestore.updateDocument(`products/${finalDocId}`, { imageUrl: '' });
        }
      } catch (e) {
        console.error('Image upload failed', e);
        this.toast.error('Failed to upload image, saving product without it.');
      }
      this.router.navigate(['/admin/products']);
    } catch (e) {
      console.error('Error saving product', e);
      this.toast.error('Failed to save product');
    } finally {
      this.isSaving.set(false);
    }
  }

  async deleteProduct() {
    if (!confirm('Are you sure you want to delete this product?')) return;
    
    this.isSaving.set(true);
    try {
      await this.firestore.softDelete(`products/${this.productId()}`, this.auth.getActionBy()?.uid || 'unknown');
      this.toast.success('Product deleted successfully');
      this.router.navigate(['/admin/products']);
    } catch (e) {
      console.error('Delete error', e);
      this.toast.error('Failed to delete product');
    } finally {
      this.isSaving.set(false);
    }
  }
}
