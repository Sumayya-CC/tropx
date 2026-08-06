import { Component, ElementRef, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Storage } from '@angular/fire/storage';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';
import { Product } from '../../../../../core/models/product.model';
import {
  FeaturedBannerSlide,
  FeaturedBannerProduct,
  FeaturedBannerOverlay,
  BannerTextAlign,
  BannerTextColor,
  BannerProductPlacement,
  MAX_BANNER_PRODUCTS,
  resolveHidePrice,
} from '../../../../../core/models/storefront-settings.model';

@Component({
  selector: 'app-featured-banner-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './featured-banner-card.component.html',
})
export class FeaturedBannerCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(Storage);

  protected readonly resolveHidePrice = resolveHidePrice;
  readonly MAX_BANNER_PRODUCTS = MAX_BANNER_PRODUCTS;

  editingFeaturedBanner = signal(false);
  isSaving = signal(false);
  featuredBannerEnabled = signal(false);
  featuredBannerAutoAdvance = signal(true);
  featuredBannerIntervalSeconds = signal(5);
  featuredBannerSlides = signal<FeaturedBannerSlide[]>([]);

  // Own lightbox, scoped to this card's slide thumbnails — Gallery card
  // (extracted in S3) already has an equivalent independent copy for the
  // same reason: each card owns its own overlay now that the shell no
  // longer has a single shared lightboxImageUrl signal.
  lightboxImageUrl = signal<string | null>(null);

  @ViewChild('bannerFileInputRef') bannerFileInputRef?: ElementRef<HTMLInputElement>;

  // New slide form state
  slideUploadFile = signal<File | null>(null);
  slideUploadPreview = signal<string>('');
  slideImageUrl = signal<string>('');
  slideSelectedProducts = signal<FeaturedBannerProduct[]>([]);

  // Product picker — searchable multi-select
  productSearchQuery = signal('');

  // Overlay fields for the new slide being built
  slideOverlayTitle = signal('');
  slideOverlayDescription = signal('');
  slideOverlayButtonLabel = signal('');
  slideOverlayButtonLink = signal('');
  slideOverlayTextAlign = signal<BannerTextAlign>('left');
  slideOverlayTextColor = signal<BannerTextColor>('light');
  slideProductPlacement = signal<BannerProductPlacement>('right');

  isUploadingSlideImage = signal(false);

  // Which existing slide (if any) is being edited via the same
  // add/edit form — null means the form is building a new slide.
  editingExistingSlideId = signal<string | null>(null);

  private products$ = this.firestore.getCollection<Product>(
    'products',
    where('tenantId', '==', 1),
    where('isDeleted', '==', false)
  );
  activeProducts = toSignal(this.products$, { initialValue: [] as Product[] });

  filteredProductsForSlide = computed(() => {
    const q = this.productSearchQuery().toLowerCase().trim();
    const all = this.activeProducts();
    if (!q) return all;
    return all.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  });

  constructor() {
    effect(() => {
      const sf = this.settings.storefront();
      // Only sync when not actively editing (prevents Firestore listener
      // from clobbering local edits) — matches the pre-split behavior.
      if (!untracked(() => this.editingFeaturedBanner())) {
        this.featuredBannerEnabled.set(sf.featuredBannerEnabled);
        this.featuredBannerAutoAdvance.set(sf.featuredBannerAutoAdvance ?? true);
        this.featuredBannerIntervalSeconds.set(sf.featuredBannerIntervalSeconds ?? 5);
        this.featuredBannerSlides.set(sf.featuredBannerSlides || []);
      }
    }, { allowSignalWrites: true });
  }

  cancelFeaturedBanner() {
    const sf = this.settings.storefront();
    this.featuredBannerEnabled.set(sf.featuredBannerEnabled);
    this.featuredBannerAutoAdvance.set(sf.featuredBannerAutoAdvance ?? true);
    this.featuredBannerIntervalSeconds.set(sf.featuredBannerIntervalSeconds ?? 5);
    this.featuredBannerSlides.set(sf.featuredBannerSlides || []);
    this.slideUploadFile.set(null);
    this.slideUploadPreview.set('');
    this.slideImageUrl.set('');
    this.slideSelectedProducts.set([]);
    this.slideOverlayTitle.set('');
    this.slideOverlayDescription.set('');
    this.slideOverlayButtonLabel.set('');
    this.slideOverlayButtonLink.set('');
    this.slideOverlayTextAlign.set('left');
    this.slideOverlayTextColor.set('light');
    this.slideProductPlacement.set('right');
    this.productSearchQuery.set('');
    this.editingFeaturedBanner.set(false);
  }

  async saveFeaturedBanner() {
    // Warn if there's a pending unsaved slide
    const hasPendingSlide = this.slideUploadFile() ||
      this.slideImageUrl() ||
      this.slideSelectedProducts().length > 0;

    if (hasPendingSlide) {
      const proceed = confirm(
        'You have an unsaved slide in progress. ' +
        'Click OK to save the banner without it, ' +
        'or Cancel to go back and click "Add this slide to the list" first.'
      );
      if (!proceed) return;
    }

    this.isSaving.set(true);
    const slidesToSave = [...this.featuredBannerSlides()];
    const enabledToSave = this.featuredBannerEnabled();
    const autoAdvanceToSave = this.featuredBannerAutoAdvance();
    const intervalToSave = this.featuredBannerIntervalSeconds();

    try {
      // Use updateDocument instead of setDocument to do a partial merge
      // This avoids the risk of the spread clobbering or dropping fields
      await this.firestore.updateDocument('settings/storefront', {
        featuredBannerEnabled: enabledToSave,
        featuredBannerAutoAdvance: autoAdvanceToSave,
        featuredBannerIntervalSeconds: intervalToSave,
        featuredBannerSlides: slidesToSave,
      });
      this.toast.success('Featured banner saved');
      setTimeout(() => this.editingFeaturedBanner.set(false), 150);
    } catch (err) {
      console.error('saveFeaturedBanner error:', err);
      // If updateDocument fails (doc doesn't exist yet), fall back to setDocument
      try {
        const current = this.settings.storefront();
        await this.firestore.setDocument('settings/storefront', {
          ...current,
          featuredBannerEnabled: enabledToSave,
          featuredBannerAutoAdvance: autoAdvanceToSave,
          featuredBannerIntervalSeconds: intervalToSave,
          featuredBannerSlides: slidesToSave,
        });
        this.toast.success('Featured banner saved');
        setTimeout(() => this.editingFeaturedBanner.set(false), 150);
      } catch (err2) {
        console.error('saveFeaturedBanner setDocument fallback error:', err2);
        this.toast.error('Failed to save featured banner');
      }
    } finally {
      this.isSaving.set(false);
    }
  }

  onSlideImageSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toast.error('Please select an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.toast.error('Image must be under 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Crop to 3:1
        const targetRatio = 3 / 1;
        const srcRatio = img.width / img.height;

        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (srcRatio > targetRatio) {
          // Too wide — crop sides
          sw = Math.round(img.height * targetRatio);
          sx = Math.round((img.width - sw) / 2);
        } else if (srcRatio < targetRatio) {
          // Too tall — crop top/bottom
          sh = Math.round(img.width / targetRatio);
          sy = Math.round((img.height - sh) / 2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 640;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 1920, 640);

        canvas.toBlob((blob) => {
          if (!blob) {
            this.toast.error('Failed to process image');
            return;
          }
          // Create a new File from the cropped blob
          const croppedFile = new File(
            [blob],
            file.name.replace(/\.[^.]+$/, '.jpg'),
            { type: 'image/jpeg' }
          );
          this.slideUploadFile.set(croppedFile);
          this.slideUploadPreview.set(canvas.toDataURL('image/jpeg', 0.92));
        }, 'image/jpeg', 0.92);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  async uploadSlideImage(): Promise<string> {
    const file = this.slideUploadFile();
    if (!file) return this.slideImageUrl();
    this.isUploadingSlideImage.set(true);
    try {
      const { ref, uploadBytes, getDownloadURL } = await import('@angular/fire/storage');
      const path = `storefront/banners/${Date.now()}_${file.name}`;
      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      this.slideImageUrl.set(url);
      this.slideUploadFile.set(null);
      this.slideUploadPreview.set('');
      return url;
    } catch (err) {
      console.error('uploadSlideImage FAILED:', err);
      throw err;
    } finally {
      this.isUploadingSlideImage.set(false);
    }
  }

  async addSlide() {
    if (!this.slideUploadFile() && !this.slideImageUrl()) {
      this.toast.error('Please upload a banner image first');
      return;
    }

    const hasProducts = this.slideSelectedProducts().length > 0;
    const hasOverlayText =
      this.slideOverlayTitle().trim() ||
      this.slideOverlayDescription().trim() ||
      this.slideOverlayButtonLabel().trim();

    // A slide can be image-only, text-only, products-only,
    // or both — the only hard requirement is the image.
    if (!hasProducts && !hasOverlayText) {
      const proceed = confirm(
        'This slide has no products and no text — it will ' +
        'be an image-only banner. Continue?'
      );
      if (!proceed) return;
    }

    try {
      const imageUrl = await this.uploadSlideImage();

      // Firestore rejects `undefined` anywhere in a document,
      // including nested inside objects — use null instead,
      // and JSON round-trip strips undefined keys entirely as
      // a second safety net.
      const overlay: FeaturedBannerOverlay | null =
        hasOverlayText ? {
          title: this.slideOverlayTitle().trim() || null,
          description: this.slideOverlayDescription().trim() || null,
          buttonLabel: this.slideOverlayButtonLabel().trim() || null,
          buttonLink: this.slideOverlayButtonLink().trim() || null,
          textAlign: this.slideOverlayTextAlign(),
          textColor: this.slideOverlayTextColor(),
        } as FeaturedBannerOverlay : null;

      const newSlideRaw = {
        id: crypto.randomUUID(),
        imageUrl,
        products: this.slideSelectedProducts(),
        productPlacement: hasProducts
          ? this.slideProductPlacement() : null,
        overlay,
        createdAt: Date.now(),
      };

      // Strip any stray undefined values as a safety net.
      const newSlide: FeaturedBannerSlide =
        JSON.parse(JSON.stringify(newSlideRaw));

      this.featuredBannerSlides.update(slides => [...slides, newSlide]);

      // Reset the new-slide form
      this.slideImageUrl.set('');
      this.slideSelectedProducts.set([]);
      this.slideOverlayTitle.set('');
      this.slideOverlayDescription.set('');
      this.slideOverlayButtonLabel.set('');
      this.slideOverlayButtonLink.set('');
      this.slideOverlayTextAlign.set('left');
      this.slideOverlayTextColor.set('light');
      this.slideProductPlacement.set('right');
      this.productSearchQuery.set('');

      if (this.bannerFileInputRef?.nativeElement) {
        this.bannerFileInputRef.nativeElement.value = '';
      }
      this.toast.success('Slide added — click Save to publish');
    } catch (err) {
      console.error('addSlide FAILED:', err);
      this.toast.error('Failed to add slide — check console for details');
    }
  }

  moveSlide(index: number, direction: -1 | 1) {
    const slides = [...this.featuredBannerSlides()];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= slides.length) return;

    [slides[index], slides[targetIndex]] =
      [slides[targetIndex], slides[index]];

    this.featuredBannerSlides.set(slides);
  }

  editSlide(slide: FeaturedBannerSlide) {
    this.editingExistingSlideId.set(slide.id);

    // Load the slide's data into the same form signals
    // used for "Add New Slide" — editing reuses that form.
    this.slideImageUrl.set(slide.imageUrl);
    this.slideUploadFile.set(null);
    this.slideUploadPreview.set('');
    this.slideSelectedProducts.set(
      slide.products.map(p => ({ ...p }))
    );
    this.slideProductPlacement.set(
      slide.productPlacement || 'right'
    );
    this.slideOverlayTitle.set(slide.overlay?.title || '');
    this.slideOverlayDescription.set(slide.overlay?.description || '');
    this.slideOverlayButtonLabel.set(slide.overlay?.buttonLabel || '');
    this.slideOverlayButtonLink.set(slide.overlay?.buttonLink || '');
    this.slideOverlayTextAlign.set(slide.overlay?.textAlign || 'left');
    this.slideOverlayTextColor.set(slide.overlay?.textColor || 'light');
    this.productSearchQuery.set('');
  }

  cancelEditSlide() {
    this.editingExistingSlideId.set(null);
    this.slideImageUrl.set('');
    this.slideUploadFile.set(null);
    this.slideUploadPreview.set('');
    this.slideSelectedProducts.set([]);
    this.slideOverlayTitle.set('');
    this.slideOverlayDescription.set('');
    this.slideOverlayButtonLabel.set('');
    this.slideOverlayButtonLink.set('');
    this.slideOverlayTextAlign.set('left');
    this.slideOverlayTextColor.set('light');
    this.slideProductPlacement.set('right');
    this.productSearchQuery.set('');
    if (this.bannerFileInputRef?.nativeElement) {
      this.bannerFileInputRef.nativeElement.value = '';
    }
  }

  async saveEditedSlide() {
    const editId = this.editingExistingSlideId();
    if (!editId) return;

    if (!this.slideUploadFile() && !this.slideImageUrl()) {
      this.toast.error('Please select a banner image');
      return;
    }

    const hasOverlayText =
      this.slideOverlayTitle().trim() ||
      this.slideOverlayDescription().trim() ||
      this.slideOverlayButtonLabel().trim();
    const hasProducts = this.slideSelectedProducts().length > 0;

    try {
      const imageUrl = await this.uploadSlideImage();

      const overlay: FeaturedBannerOverlay | null =
        hasOverlayText ? {
          title: this.slideOverlayTitle().trim() || null,
          description: this.slideOverlayDescription().trim() || null,
          buttonLabel: this.slideOverlayButtonLabel().trim() || null,
          buttonLink: this.slideOverlayButtonLink().trim() || null,
          textAlign: this.slideOverlayTextAlign(),
          textColor: this.slideOverlayTextColor(),
        } as FeaturedBannerOverlay : null;

      const updatedRaw = {
        id: editId,
        imageUrl,
        products: this.slideSelectedProducts(),
        productPlacement: hasProducts
          ? this.slideProductPlacement() : null,
        overlay,
        createdAt: this.featuredBannerSlides()
          .find(s => s.id === editId)?.createdAt || Date.now(),
      };

      const updated: FeaturedBannerSlide =
        JSON.parse(JSON.stringify(updatedRaw));

      this.featuredBannerSlides.update(slides =>
        slides.map(s => s.id === editId ? updated : s)
      );

      this.cancelEditSlide();
      this.toast.success('Slide updated — click Save to publish');
    } catch (err) {
      console.error('saveEditedSlide FAILED:', err);
      this.toast.error('Failed to update slide');
    }
  }

  removeSlide(id: string) {
    this.featuredBannerSlides.update(slides =>
      slides.filter(s => s.id !== id)
    );
  }

  toggleSlideProduct(productId: string) {
    const current = this.slideSelectedProducts();
    const exists = current.find(p => p.productId === productId);
    if (exists) {
      this.slideSelectedProducts.update(list =>
        list.filter(p => p.productId !== productId)
      );
    } else {
      if (current.length >= MAX_BANNER_PRODUCTS) {
        this.toast.error(
          `Maximum ${MAX_BANNER_PRODUCTS} products per slide`
        );
        return;
      }
      this.slideSelectedProducts.update(list => [
        ...list,
        { productId, hidePrice: false }
      ]);
    }
  }

  toggleSlideProductPrice(productId: string) {
    this.slideSelectedProducts.update(list =>
      list.map(p => p.productId === productId
        ? { ...p, hidePrice: !resolveHidePrice(p) }
        : p
      )
    );
  }

  isProductSelectedForSlide(productId: string): boolean {
    return this.slideSelectedProducts().some(p => p.productId === productId);
  }

  getSlideProductName(productId: string): string {
    return this.activeProducts().find(p => p.id === productId)?.name || productId;
  }

  getProductHidePrice(productId: string): boolean {
    const p = this.slideSelectedProducts()
      .find(sp => sp.productId === productId);
    return p ? resolveHidePrice(p) : false;
  }
}
