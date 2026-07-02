import { Component, inject, signal, effect, computed, untracked, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SettingsService } from '../../../core/services/settings.service';
import { Storage } from '@angular/fire/storage';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { StorefrontGalleryImage, StorefrontSettings, FeaturedBannerSlide, FeaturedBannerProduct } from '../../../core/models/storefront-settings.model';
import { Product } from '../../../core/models/product.model';

type SettingsTab = 'business' | 'ordering' | 'storefront' | 'invoice' | 'notifications' | 'system';

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly storage = inject(Storage);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly TABS = ['business', 'ordering', 'storefront', 'invoice', 'notifications', 'system'] as const;
  activeTab = signal<SettingsTab>('business');



  ordering = this.settings.ordering;
  protected readonly Math = Math;

  editingBusiness = signal(false);
  editingInvoice = signal(false);
  editingOrdering = signal(false);
  editingDelivery = signal(false);
  editingPaymentMethods = signal(false);
  editingStockBackorder = signal(false);
  editingMinimumOrder = signal(false);
  editingClosure = signal(false);
  editingNotifications = signal(false);

  editingReconciliation = signal(false);

  // Reconciliation form signals
  reconNotifyThresholdDollars = signal(1);
  reconAutoCorrectMaxDollars = signal(50);
  reconAutoCorrectEnabled = signal(true);
  reconNotifyAdmin = signal(true);

  // Storefront — Featured Banner
  editingFeaturedBanner = signal(false);
  featuredBannerEnabled = signal(false);
  featuredBannerAutoAdvance = signal(true);
  featuredBannerIntervalSeconds = signal(5);
  featuredBannerSlides = signal<FeaturedBannerSlide[]>([]);

  // Per-slide edit state (which slide is being edited, null = none)
  editingSlideId = signal<string | null>(null);

  lightboxImageUrl = signal<string | null>(null);
  @ViewChild('bannerFileInputRef') bannerFileInputRef?: ElementRef<HTMLInputElement>;

  // New slide form state
  slideUploadFile = signal<File | null>(null);
  slideUploadPreview = signal<string>('');
  slideImageUrl = signal<string>('');
  slideSelectedProducts = signal<FeaturedBannerProduct[]>([]);
  isUploadingSlideImage = signal(false);

  // Storefront — Home sections toggles
  editingHomeSections = signal(false);
  orderAgainEnabled = signal(true);
  newArrivalsEnabled = signal(true);
  newArrivalsAutoDays = signal(14);
  popularEnabled = signal(true);

  // Storefront — Gallery
  editingGallery = signal(false);
  galleryEnabled = signal(false);
  galleryImages = signal<StorefrontGalleryImage[]>([]);
  galleryUploadFile = signal<File | null>(null);
  galleryUploadPreview = signal<string>('');
  galleryUploadCaption = signal('');
  isUploadingGalleryImage = signal(false);

  private products$ = this.firestore.getCollection<Product>(
    'products',
    where('tenantId', '==', 1),
    where('isDeleted', '==', false)
  );
  activeProducts = toSignal(this.products$, { initialValue: [] as Product[] });



  isSaving = signal(false);

  protected readonly SOCIAL_PLATFORMS = [
    { key: 'facebook', label: 'Facebook',
      placeholder: 'https://facebook.com/...' },
    { key: 'instagram', label: 'Instagram',
      placeholder: 'https://instagram.com/...' },
    { key: 'whatsapp', label: 'WhatsApp',
      placeholder: 'https://wa.me/15191234567' },
    { key: 'youtube', label: 'YouTube',
      placeholder: 'https://youtube.com/@...' },
    { key: 'tiktok', label: 'TikTok',
      placeholder: 'https://tiktok.com/@...' },
  ] as const;

  activeSocialFields = signal<string[]>([]);

  availableSocialPlatforms = computed(() => {
    const active = this.activeSocialFields();
    return this.SOCIAL_PLATFORMS.filter(
      p => !active.includes(p.key)
    );
  });

  populatedSocialLinks = computed(() => {
    const sm = this.settings.business().socialMedia;
    if (!sm) return [];
    return this.SOCIAL_PLATFORMS.filter(
      p => !!(sm as any)[p.key]
    ).map(p => ({
      key: p.key,
      label: p.label,
      url: (sm as any)[p.key] as string,
    }));
  });

  // Business form fields
  companyName = signal('');
  tradingName = signal('');
  logoUrl = signal('');
  logoFile = signal<File | null>(null);
  logoPreview = signal('');
  street = signal('');
  city = signal('');
  province = signal('');
  postalCode = signal('');
  country = signal('Canada');
  phone = signal('');
  email = signal('');
  website = signal('');
  businessNumber = signal('');
  hstNumber = signal('');
  currencyCode = signal('CAD');
  timezone = signal('America/Toronto');
  facebookUrl = signal('');
  instagramUrl = signal('');
  whatsappUrl = signal('');
  youtubeUrl = signal('');
  tiktokUrl = signal('');

  // Invoice form fields
  paymentTermsDays = signal(30);
  footerMessage = signal('Thank you for your business!');
  etransferEmail = signal('');
  acceptCash = signal(true);
  showHstBreakdown = signal(true);
  portalInvoiceDownloadEnabled = signal(true);
  portalInvoiceDownloadNote = signal(
    'Invoice will be sent by email once your order is delivered.'
  );

  // Ordering form fields
  defaultTaxRatePercent = signal(13);
  defaultDeliveryType = signal<'delivery' | 'pickup'>('delivery');
  orderPrefix = signal('TRX');
  paymentPrefix = signal('PAY');
  returnPrefix = signal('RET');
  overdueAfterDays = signal(30);

  // Delivery options
  deliveryOptions = signal<'delivery_only' | 'pickup_only' | 'both'>('both');
  pickupAddressMode = signal<'same_as_business' | 'custom'>('same_as_business');
  pickupStreet = signal('');
  pickupCity = signal('');
  pickupProvince = signal('');
  pickupPostalCode = signal('');
  deliveryEstimateDays = signal(2);
  deliveryEstimateText = signal('Delivered within {days} business days');

  // Payment methods
  paymentCashOnDelivery = signal(true);
  paymentETransfer = signal(true);
  paymentCheque = signal(false);

  // Stock & backorder
  lowStockVisibility = signal<'none' | 'vague' | 'exact'>('vague');
  lowStockCustomerThreshold = signal(5);
  outOfStockBehavior = signal<'hide' | 'show_disabled' | 'allow_backorder'>('show_disabled');
  showBackorderMessage = signal(true);
  backorderMessage = signal(
    'This item is currently low in stock. ' +
    'We may need additional time to fulfill ' +
    'part of your order.'
  );

  // Minimum order
  minimumOrderEnabled = signal(false);
  minimumOrderScope = signal<'cart' | 'per_product'>('cart');
  minimumOrderType = signal<'quantity' | 'amount'>('amount');
  minimumOrderValue = signal(0);

  // Closure
  closureActive = signal(false);
  closureMessage = signal('');

  // Notification settings form fields
  newOrderAlert = signal(true);
  accessRequestAlert = signal(true);
  returnSubmittedAlert = signal(true);
  lowStockAlert = signal(true);

  customerOrderConfirmed = signal(true);
  customerOutForDelivery = signal(true);
  customerOrderDelivered = signal(true);
  customerOrderCancelled = signal(true);
  customerReturnApproved = signal(true);
  customerReturnRejected = signal(true);
  customerPaymentReceipt = signal(true);

  // Prefix warning: show if user changes prefix
  orderPrefixChanged = signal(false);
  paymentPrefixChanged = signal(false);
  returnPrefixChanged = signal(false);

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab') as SettingsTab | null;
      this.activeTab.set(
        tab && (this.TABS as readonly string[]).includes(tab) ? tab : 'business'
      );
    });

    effect(() => {
      const b = this.settings.business();
      this.companyName.set(b.companyName);
      this.tradingName.set(b.tradingName);
      this.logoUrl.set(b.logoUrl || '');
      this.logoPreview.set(b.logoUrl || '');
      this.street.set(b.street || '');
      this.city.set(b.city || '');
      this.province.set(b.province ?? '');
      this.postalCode.set(b.postalCode || '');
      this.country.set(b.country || 'Canada');
      this.phone.set(b.phone || '');
      this.email.set(b.email || '');
      this.website.set(b.website || '');
      this.businessNumber.set(b.businessNumber || '');
      this.hstNumber.set(b.hstNumber || '');
      this.currencyCode.set(b.currencyCode || 'CAD');
      this.timezone.set(b.timezone || 'America/Toronto');
      this.facebookUrl.set(b.socialMedia?.facebook || '');
      this.instagramUrl.set(b.socialMedia?.instagram || '');
      this.whatsappUrl.set(b.socialMedia?.whatsapp || '');
      this.youtubeUrl.set(b.socialMedia?.youtube || '');
      this.tiktokUrl.set(b.socialMedia?.tiktok || '');
    }, { allowSignalWrites: true });

    effect(() => {
      const inv = this.settings.invoice();
      this.paymentTermsDays.set(inv.paymentTermsDays);
      this.footerMessage.set(inv.footerMessage || '');
      this.etransferEmail.set(inv.etransferEmail || '');
      this.acceptCash.set(inv.acceptCash);
      this.showHstBreakdown.set(inv.showHstBreakdown);
      this.portalInvoiceDownloadEnabled.set(
        inv.portalInvoiceDownloadEnabled ?? true
      );
      this.portalInvoiceDownloadNote.set(
        inv.portalInvoiceDownloadNote ||
        'Invoice will be sent by email once your order is delivered.'
      );
    }, { allowSignalWrites: true });

    effect(() => {
      const ord = this.settings.ordering();
      this.defaultTaxRatePercent.set(ord.defaultTaxRatePercent);
      this.defaultDeliveryType.set(ord.defaultDeliveryType || 'delivery');
      this.orderPrefix.set(ord.orderPrefix || 'TRX');
      this.paymentPrefix.set(ord.paymentPrefix || 'PAY');
      this.returnPrefix.set(ord.returnPrefix || 'RET');
      this.overdueAfterDays.set(ord.overdueAfterDays || 30);

      this.deliveryOptions.set(ord.deliveryOptions || 'both');
      this.pickupAddressMode.set(ord.pickupAddressMode || 'same_as_business');
      this.pickupStreet.set(ord.pickupCustomAddress?.street || '');
      this.pickupCity.set(ord.pickupCustomAddress?.city || '');
      this.pickupProvince.set(ord.pickupCustomAddress?.province || '');
      this.pickupPostalCode.set(ord.pickupCustomAddress?.postalCode || '');
      this.deliveryEstimateDays.set(ord.deliveryEstimateDays ?? 2);
      this.deliveryEstimateText.set(
        ord.deliveryEstimateText ||
        'Delivered within {days} business days'
      );

      this.paymentCashOnDelivery.set(
        ord.paymentMethodsShown?.cashOnDelivery ?? true
      );
      this.paymentETransfer.set(
        ord.paymentMethodsShown?.eTransfer ?? true
      );
      this.paymentCheque.set(
        ord.paymentMethodsShown?.cheque ?? false
      );

      this.lowStockVisibility.set(ord.lowStockVisibility || 'vague');
      this.lowStockCustomerThreshold.set(ord.lowStockCustomerThreshold ?? 5);
      this.outOfStockBehavior.set(ord.outOfStockBehavior || 'show_disabled');
      this.showBackorderMessage.set(ord.showBackorderMessage ?? true);
      this.backorderMessage.set(
        ord.backorderMessage ||
        'This item is currently low in stock. ' +
        'We may need additional time to fulfill ' +
        'part of your order.'
      );

      this.minimumOrderEnabled.set(ord.minimumOrderEnabled ?? false);
      this.minimumOrderScope.set(ord.minimumOrderScope || 'cart');
      this.minimumOrderType.set(ord.minimumOrderType || 'amount');
      this.minimumOrderValue.set(
        ord.minimumOrderType === 'amount'
          ? (ord.minimumOrderValue ?? 0) / 100
          : (ord.minimumOrderValue ?? 0)
      );

      this.closureActive.set(ord.closureActive ?? false);
      this.closureMessage.set(ord.closureMessage || '');
    }, { allowSignalWrites: true });

    effect(() => {
      const n = this.settings.notifications();
      this.newOrderAlert.set(n.newOrderAlert);
      this.accessRequestAlert.set(n.accessRequestAlert);
      this.returnSubmittedAlert.set(n.returnSubmittedAlert);
      this.lowStockAlert.set(n.lowStockAlert);
      this.customerOrderConfirmed.set(n.customerOrderConfirmed);
      this.customerOutForDelivery.set(n.customerOutForDelivery);
      this.customerOrderDelivered.set(n.customerOrderDelivered);
      this.customerOrderCancelled.set(n.customerOrderCancelled);
      this.customerReturnApproved.set(n.customerReturnApproved);
      this.customerReturnRejected.set(n.customerReturnRejected);
      this.customerPaymentReceipt.set(n.customerPaymentReceipt);
    }, { allowSignalWrites: true });

    effect(() => {
      const r = this.settings.reconciliation();
      this.reconNotifyThresholdDollars.set(
        r.notifyThresholdCents / 100
      );
      this.reconAutoCorrectMaxDollars.set(
        r.autoCorrectMaxCents / 100
      );
      this.reconAutoCorrectEnabled.set(r.autoCorrectEnabled);
      this.reconNotifyAdmin.set(r.notifyAdmin);
    }, { allowSignalWrites: true });

    effect(() => {
      const sf = this.settings.storefront();
      
      // Only sync featured banner state when not actively editing
      // (prevents Firestore listener from clobbering local edits)
      if (!untracked(() => this.editingFeaturedBanner())) {
        this.featuredBannerEnabled.set(sf.featuredBannerEnabled);
        this.featuredBannerAutoAdvance.set(sf.featuredBannerAutoAdvance ?? true);
        this.featuredBannerIntervalSeconds.set(sf.featuredBannerIntervalSeconds ?? 5);
        this.featuredBannerSlides.set(sf.featuredBannerSlides || []);
      }
      
      this.orderAgainEnabled.set(sf.orderAgainEnabled);
      this.newArrivalsEnabled.set(sf.newArrivalsEnabled);
      this.newArrivalsAutoDays.set(sf.newArrivalsAutoDays ?? 14);
      this.popularEnabled.set(sf.popularEnabled);
      
      if (!untracked(() => this.editingGallery())) {
        this.galleryEnabled.set(sf.galleryEnabled);
        this.galleryImages.set(sf.galleryImages || []);
      }
    }, { allowSignalWrites: true });
  }

  setActiveTab(tab: SettingsTab) {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
  }

  cancelFeaturedBanner() {
    const sf = this.settings.storefront();
    this.featuredBannerEnabled.set(sf.featuredBannerEnabled);
    this.featuredBannerAutoAdvance.set(sf.featuredBannerAutoAdvance ?? true);
    this.featuredBannerIntervalSeconds.set(sf.featuredBannerIntervalSeconds ?? 5);
    this.featuredBannerSlides.set(sf.featuredBannerSlides || []);
    this.editingSlideId.set(null);
    this.slideUploadFile.set(null);
    this.slideUploadPreview.set('');
    this.slideImageUrl.set('');
    this.slideSelectedProducts.set([]);
    this.editingFeaturedBanner.set(false);
  }

  cancelHomeSections() {
    const sf = this.settings.storefront();
    this.orderAgainEnabled.set(sf.orderAgainEnabled);
    this.newArrivalsEnabled.set(sf.newArrivalsEnabled);
    this.newArrivalsAutoDays.set(sf.newArrivalsAutoDays ?? 14);
    this.popularEnabled.set(sf.popularEnabled);
    this.editingHomeSections.set(false);
  }

  cancelGallery() {
    const sf = this.settings.storefront();
    this.galleryEnabled.set(sf.galleryEnabled);
    this.galleryImages.set(sf.galleryImages || []);
    this.galleryUploadFile.set(null);
    this.galleryUploadPreview.set('');
    this.galleryUploadCaption.set('');
    this.editingGallery.set(false);
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

    console.log('saveFeaturedBanner ENTRY, slides:',
      this.featuredBannerSlides().length);
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
    if (this.slideSelectedProducts().length === 0) {
      this.toast.error('Please select at least one product');
      return;
    }
    try {
      const imageUrl = await this.uploadSlideImage();
      const newSlide: FeaturedBannerSlide = {
        id: crypto.randomUUID(),
        imageUrl,
        products: this.slideSelectedProducts(),
        createdAt: Date.now(),
      };
      this.featuredBannerSlides.update(slides => [...slides, newSlide]);
      this.slideImageUrl.set('');
      this.slideSelectedProducts.set([]);
      // Clear the native file input so the filename disappears
      if (this.bannerFileInputRef?.nativeElement) {
        this.bannerFileInputRef.nativeElement.value = '';
      }
      this.toast.success('Slide added — click Save to publish');
    } catch (err) {
      console.error('addSlide FAILED:', err);
      this.toast.error('Failed to add slide — check console for details');
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
      if (current.length >= 4) {
        this.toast.error('Maximum 4 products per slide');
        return;
      }
      this.slideSelectedProducts.update(list => [
        ...list,
        { productId, showPrice: true }
      ]);
    }
  }

  toggleSlideProductPrice(productId: string) {
    this.slideSelectedProducts.update(list =>
      list.map(p => p.productId === productId
        ? { ...p, showPrice: !p.showPrice }
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

  getProductShowPrice(productId: string): boolean {
    return this.slideSelectedProducts().find(p => p.productId === productId)?.showPrice ?? true;
  }

  async saveHomeSections() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/storefront', {
        ...this.settings.storefront(),
        orderAgainEnabled: this.orderAgainEnabled(),
        newArrivalsEnabled: this.newArrivalsEnabled(),
        newArrivalsAutoDays: this.newArrivalsAutoDays(),
        popularEnabled: this.popularEnabled(),
      });
      this.toast.success('Home section settings saved');
      this.editingHomeSections.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save home section settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  onGalleryFileSelected(event: Event) {
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
    this.galleryUploadFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => this.galleryUploadPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  async addGalleryImage() {
    const file = this.galleryUploadFile();
    if (!file) {
      this.toast.error('Please select an image first');
      return;
    }
    this.isUploadingGalleryImage.set(true);
    try {
      const { ref, uploadBytes, getDownloadURL } = await import('@angular/fire/storage');
      const path = `storefront/gallery/${Date.now()}_${file.name}`;
      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      const newImage: StorefrontGalleryImage = {
        id: crypto.randomUUID(),
        imageUrl: url,
        caption: this.galleryUploadCaption().trim(),
        createdAt: Date.now(),
      };

      this.galleryImages.update(list => [...list, newImage]);
      this.galleryUploadFile.set(null);
      this.galleryUploadPreview.set('');
      this.galleryUploadCaption.set('');
      this.toast.success('Image added — remember to save');
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to upload image');
    } finally {
      this.isUploadingGalleryImage.set(false);
    }
  }

  removeGalleryImage(id: string) {
    this.galleryImages.update(list => list.filter(img => img.id !== id));
  }

  async saveGallery() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/storefront', {
        ...this.settings.storefront(),
        galleryEnabled: this.galleryEnabled(),
        galleryImages: this.galleryImages(),
      });
      this.toast.success('Gallery saved');
      this.editingGallery.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save gallery');
    } finally {
      this.isSaving.set(false);
    }
  }

  editBusiness() {
    const b = this.settings.business();
    const active = this.SOCIAL_PLATFORMS
      .filter(p => !!(b.socialMedia as any)?.[p.key])
      .map(p => p.key);
    this.activeSocialFields.set(active);
    this.editingBusiness.set(true);
  }

  cancelBusiness() {
    const b = this.settings.business();
    this.companyName.set(b.companyName);
    this.tradingName.set(b.tradingName);
    this.logoUrl.set(b.logoUrl || '');
    this.logoPreview.set(b.logoUrl || '');
    this.logoFile.set(null);
    this.street.set(b.street || '');
    this.city.set(b.city || '');
    this.province.set(b.province ?? '');
    this.postalCode.set(b.postalCode || '');
    this.country.set(b.country || 'Canada');
    this.phone.set(b.phone || '');
    this.email.set(b.email || '');
    this.website.set(b.website || '');
    this.businessNumber.set(b.businessNumber || '');
    this.hstNumber.set(b.hstNumber || '');
    this.currencyCode.set(b.currencyCode || 'CAD');
    this.timezone.set(b.timezone || 'America/Toronto');
    this.facebookUrl.set(b.socialMedia?.facebook || '');
    this.instagramUrl.set(b.socialMedia?.instagram || '');
    this.whatsappUrl.set(b.socialMedia?.whatsapp || '');
    this.youtubeUrl.set(b.socialMedia?.youtube || '');
    this.tiktokUrl.set(b.socialMedia?.tiktok || '');
    const active = this.SOCIAL_PLATFORMS
      .filter(p => !!(b.socialMedia as any)?.[p.key])
      .map(p => p.key);
    this.activeSocialFields.set(active);
    this.editingBusiness.set(false);
  }

  cancelInvoice() {
    const inv = this.settings.invoice();
    this.paymentTermsDays.set(inv.paymentTermsDays);
    this.footerMessage.set(inv.footerMessage || '');
    this.etransferEmail.set(inv.etransferEmail || '');
    this.acceptCash.set(inv.acceptCash);
    this.showHstBreakdown.set(inv.showHstBreakdown);
    this.portalInvoiceDownloadEnabled.set(
      inv.portalInvoiceDownloadEnabled ?? true
    );
    this.portalInvoiceDownloadNote.set(
      inv.portalInvoiceDownloadNote ||
      'Invoice will be sent by email once your order is delivered.'
    );
    this.editingInvoice.set(false);
  }

  cancelOrdering() {
    const ord = this.settings.ordering();
    this.defaultTaxRatePercent.set(ord.defaultTaxRatePercent);
    this.defaultDeliveryType.set(ord.defaultDeliveryType || 'delivery');
    this.orderPrefix.set(ord.orderPrefix || 'TRX');
    this.paymentPrefix.set(ord.paymentPrefix || 'PAY');
    this.returnPrefix.set(ord.returnPrefix || 'RET');
    this.overdueAfterDays.set(ord.overdueAfterDays || 30);
    this.orderPrefixChanged.set(false);
    this.paymentPrefixChanged.set(false);
    this.returnPrefixChanged.set(false);
    this.editingOrdering.set(false);
  }

  cancelDelivery() {
    const ord = this.settings.ordering();
    this.deliveryOptions.set(
      ord.deliveryOptions || 'both');
    this.pickupAddressMode.set(
      ord.pickupAddressMode || 'same_as_business');
    this.pickupStreet.set(
      ord.pickupCustomAddress?.street || '');
    this.pickupCity.set(
      ord.pickupCustomAddress?.city || '');
    this.pickupProvince.set(
      ord.pickupCustomAddress?.province || '');
    this.pickupPostalCode.set(
      ord.pickupCustomAddress?.postalCode || '');
    this.deliveryEstimateDays.set(
      ord.deliveryEstimateDays ?? 2);
    this.deliveryEstimateText.set(
      ord.deliveryEstimateText ||
      'Delivered within {days} business days');
    this.editingDelivery.set(false);
  }

  cancelPaymentMethods() {
    const ord = this.settings.ordering();
    this.paymentCashOnDelivery.set(
      ord.paymentMethodsShown?.cashOnDelivery ?? true);
    this.paymentETransfer.set(
      ord.paymentMethodsShown?.eTransfer ?? true);
    this.paymentCheque.set(
      ord.paymentMethodsShown?.cheque ?? false);
    this.editingPaymentMethods.set(false);
  }

  cancelStockBackorder() {
    const ord = this.settings.ordering();
    this.lowStockVisibility.set(
      ord.lowStockVisibility || 'vague');
    this.lowStockCustomerThreshold.set(
      ord.lowStockCustomerThreshold ?? 5);
    this.outOfStockBehavior.set(
      ord.outOfStockBehavior || 'show_disabled');
    this.showBackorderMessage.set(
      ord.showBackorderMessage ?? true);
    this.backorderMessage.set(
      ord.backorderMessage ||
      'This item is currently low in stock. ' +
      'We may need additional time to fulfill ' +
      'part of your order.');
    this.editingStockBackorder.set(false);
  }

  cancelMinimumOrder() {
    const ord = this.settings.ordering();
    this.minimumOrderEnabled.set(
      ord.minimumOrderEnabled ?? false);
    this.minimumOrderScope.set(
      ord.minimumOrderScope || 'cart');
    this.minimumOrderType.set(
      ord.minimumOrderType || 'amount');
    this.minimumOrderValue.set(
      ord.minimumOrderType === 'amount'
        ? (ord.minimumOrderValue ?? 0) / 100
        : (ord.minimumOrderValue ?? 0));
    this.editingMinimumOrder.set(false);
  }

  cancelClosure() {
    const ord = this.settings.ordering();
    this.closureActive.set(
      ord.closureActive ?? false);
    this.closureMessage.set(
      ord.closureMessage || '');
    this.editingClosure.set(false);
  }

  cancelNotifications() {
    const n = this.settings.notifications();
    this.newOrderAlert.set(n.newOrderAlert);
    this.accessRequestAlert.set(n.accessRequestAlert);
    this.returnSubmittedAlert.set(n.returnSubmittedAlert);
    this.lowStockAlert.set(n.lowStockAlert);
    this.customerOrderConfirmed.set(n.customerOrderConfirmed);
    this.customerOutForDelivery.set(n.customerOutForDelivery);
    this.customerOrderDelivered.set(n.customerOrderDelivered);
    this.customerOrderCancelled.set(n.customerOrderCancelled);
    this.customerReturnApproved.set(n.customerReturnApproved);
    this.customerReturnRejected.set(n.customerReturnRejected);
    this.customerPaymentReceipt.set(n.customerPaymentReceipt);
    this.editingNotifications.set(false);
  }

  async updateNotification(key: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    try {
      await this.firestore.updateDocument('settings/notifications', {
        [key]: checked
      });
      this.toast.success('Notification setting updated');
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to update notification setting');
    }
  }

  async saveNotifications() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/notifications', {
        newOrderAlert: this.newOrderAlert(),
        accessRequestAlert: this.accessRequestAlert(),
        returnSubmittedAlert: this.returnSubmittedAlert(),
        lowStockAlert: this.lowStockAlert(),
        customerOrderConfirmed: this.customerOrderConfirmed(),
        customerOutForDelivery: this.customerOutForDelivery(),
        customerOrderDelivered: this.customerOrderDelivered(),
        customerOrderCancelled: this.customerOrderCancelled(),
        customerReturnApproved: this.customerReturnApproved(),
        customerReturnRejected: this.customerReturnRejected(),
        customerPaymentReceipt: this.customerPaymentReceipt(),
        abandonedCart24h: this.settings.notifications().abandonedCart24h,
        abandonedCart72h: this.settings.notifications().abandonedCart72h,
        abandonedCart7d: this.settings.notifications().abandonedCart7d,
      });
      this.toast.success('Notification settings saved');
      this.editingNotifications.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save notification settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveBusiness() {
    this.isSaving.set(true);
    try {
      let finalLogoUrl = this.logoUrl();

      if (this.logoFile()) {
        finalLogoUrl = await this.settings.uploadLogo(this.logoFile()!);
        this.logoUrl.set(finalLogoUrl);
        this.logoFile.set(null);
      }

      await this.firestore.setDocument('settings/business', {
        companyName: this.companyName(),
        tradingName: this.tradingName(),
        logoUrl: finalLogoUrl,
        street: this.street(),
        city: this.city(),
        province: this.province(),
        postalCode: this.postalCode(),
        country: this.country(),
        phone: this.phone(),
        email: this.email(),
        website: this.website(),
        businessNumber: this.businessNumber(),
        hstNumber: this.hstNumber(),
        currencyCode: this.currencyCode(),
        timezone: this.timezone(),
        socialMedia: {
          facebook: this.facebookUrl().trim(),
          instagram: this.instagramUrl().trim(),
          whatsapp: this.whatsappUrl().trim(),
          youtube: this.youtubeUrl().trim(),
          tiktok: this.tiktokUrl().trim(),
        },
      });
      this.toast.success('Business settings saved');
      this.editingBusiness.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save business settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  getSocialValue(key: string): string {
    switch (key) {
      case 'facebook': return this.facebookUrl();
      case 'instagram': return this.instagramUrl();
      case 'whatsapp': return this.whatsappUrl();
      case 'youtube': return this.youtubeUrl();
      case 'tiktok': return this.tiktokUrl();
      default: return '';
    }
  }

  setSocialValue(key: string, value: string) {
    switch (key) {
      case 'facebook': this.facebookUrl.set(value); break;
      case 'instagram': this.instagramUrl.set(value); break;
      case 'whatsapp': this.whatsappUrl.set(value); break;
      case 'youtube': this.youtubeUrl.set(value); break;
      case 'tiktok': this.tiktokUrl.set(value); break;
    }
  }

  getSocialLabel(key: string): string {
    return this.SOCIAL_PLATFORMS.find(
      p => p.key === key)?.label || key;
  }

  getSocialPlaceholder(key: string): string {
    return this.SOCIAL_PLATFORMS.find(
      p => p.key === key)?.placeholder || '';
  }

  addSocialPlatform(key: string) {
    if (!this.activeSocialFields().includes(key)) {
      this.activeSocialFields.update(
        arr => [...arr, key]
      );
    }
  }

  removeSocialPlatform(key: string) {
    this.activeSocialFields.update(
      arr => arr.filter(k => k !== key)
    );
    this.setSocialValue(key, '');
  }

  async saveInvoice() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/invoice', {
        paymentTermsDays: this.paymentTermsDays(),
        footerMessage: this.footerMessage(),
        etransferEmail: this.etransferEmail(),
        acceptCash: this.acceptCash(),
        showHstBreakdown: this.showHstBreakdown(),
        portalInvoiceDownloadEnabled: this.portalInvoiceDownloadEnabled(),
        portalInvoiceDownloadNote: this.portalInvoiceDownloadNote(),
      });
      this.toast.success('Invoice settings saved');
      this.editingInvoice.set(false);
    } catch (err) {
      this.toast.error('Failed to save invoice settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveOrdering() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/ordering', {
        defaultTaxRatePercent: this.defaultTaxRatePercent(),
        defaultDeliveryType: this.defaultDeliveryType(),
        orderPrefix: this.orderPrefix(),
        paymentPrefix: this.paymentPrefix(),
        returnPrefix: this.returnPrefix(),
        overdueAfterDays: this.overdueAfterDays(),
      });

      // Update sequence docs if prefix changed
      if (this.orderPrefixChanged()) {
        await this.firestore.updateDocument('settings/orderSequence', {
          prefix: this.orderPrefix(),
        });
        this.orderPrefixChanged.set(false);
      }
      if (this.paymentPrefixChanged()) {
        await this.firestore.updateDocument('settings/paymentSequence', {
          prefix: this.paymentPrefix(),
        });
        this.paymentPrefixChanged.set(false);
      }
      if (this.returnPrefixChanged()) {
        await this.firestore.updateDocument('settings/returnSequence', {
          prefix: this.returnPrefix(),
        });
        this.returnPrefixChanged.set(false);
      }

      this.toast.success('Ordering settings saved');
      this.editingOrdering.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save ordering settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveDelivery() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        deliveryOptions: this.deliveryOptions(),
        pickupAddressMode: this.pickupAddressMode(),
        pickupCustomAddress:
          this.pickupAddressMode() === 'custom'
            ? {
                street: this.pickupStreet(),
                city: this.pickupCity(),
                province: this.pickupProvince(),
                postalCode: this.pickupPostalCode(),
              }
            : null,
        deliveryEstimateDays:
          this.deliveryEstimateDays(),
        deliveryEstimateText:
          this.deliveryEstimateText(),
      });
      this.toast.success('Delivery settings saved');
      this.editingDelivery.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save delivery settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async savePaymentMethods() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        paymentMethodsShown: {
          cashOnDelivery:
            this.paymentCashOnDelivery(),
          eTransfer: this.paymentETransfer(),
          cheque: this.paymentCheque(),
        },
      });
      this.toast.success(
        'Payment methods saved');
      this.editingPaymentMethods.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save payment methods');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveStockBackorder() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        lowStockVisibility:
          this.lowStockVisibility(),
        lowStockCustomerThreshold:
          this.lowStockCustomerThreshold(),
        outOfStockBehavior: this.outOfStockBehavior(),
        showBackorderMessage:
          this.showBackorderMessage(),
        backorderMessage: this.backorderMessage(),
      });
      this.toast.success(
        'Stock settings saved');
      this.editingStockBackorder.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save stock settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveMinimumOrder() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        minimumOrderEnabled:
          this.minimumOrderEnabled(),
        minimumOrderScope:
          this.minimumOrderScope(),
        minimumOrderType:
          this.minimumOrderType(),
        minimumOrderValue:
          this.minimumOrderType() === 'amount'
            ? Math.round(
                this.minimumOrderValue() * 100)
            : this.minimumOrderValue(),
      });
      this.toast.success(
        'Minimum order settings saved');
      this.editingMinimumOrder.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save minimum order settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveClosure() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument(
        'settings/ordering', {
        closureActive: this.closureActive(),
        closureMessage:
          this.closureMessage() || null,
      });
      this.toast.success(
        'Closure settings saved');
      this.editingClosure.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save closure settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  onLogoSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      this.toast.error('Logo must be under 2MB');
      return;
    }
    this.logoFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => this.logoPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  removeLogo() {
    this.logoFile.set(null);
    this.logoPreview.set('');
    this.logoUrl.set('');
  }

  cancelReconciliation() {
    const r = this.settings.reconciliation();
    this.reconNotifyThresholdDollars.set(
      r.notifyThresholdCents / 100
    );
    this.reconAutoCorrectMaxDollars.set(
      r.autoCorrectMaxCents / 100
    );
    this.reconAutoCorrectEnabled.set(r.autoCorrectEnabled);
    this.reconNotifyAdmin.set(r.notifyAdmin);
    this.editingReconciliation.set(false);
  }

  async saveReconciliation() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument(
        'settings/reconciliation', {
          notifyThresholdCents: Math.round(
            this.reconNotifyThresholdDollars() * 100
          ),
          autoCorrectMaxCents: Math.round(
            this.reconAutoCorrectMaxDollars() * 100
          ),
          autoCorrectEnabled: this.reconAutoCorrectEnabled(),
          notifyAdmin: this.reconNotifyAdmin(),
          tenantId: 1,
        }
      );
      this.toast.success('Reconciliation settings saved');
      this.editingReconciliation.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error(
        'Failed to save reconciliation settings'
      );
    } finally {
      this.isSaving.set(false);
    }
  }

  exporting = signal<string | null>(null);

  async exportToCsv(type: 'orders' | 'payments' | 'customers') {
    this.exporting.set(type);
    try {
      const { firstValueFrom } = await import('rxjs');
      let data: any[] = [];
      
      if (type === 'orders') {
        const obs = this.firestore.getCollection<any>('orders');
        const all = await firstValueFrom(obs);
        data = all.filter(item => !item.isDeleted);
        
        const headers = [
          'Order ID', 'Order Number', 'Customer Name', 'Customer Email',
          'Delivery Type', 'Service Area', 'Status', 'Subtotal', 'Discount',
          'HST', 'Total', 'Balance', 'Confirmed At', 'Created At'
        ];
        
        const rows = data.map(o => [
          o.id,
          o.orderNumber,
          o.customerName,
          o.customerEmail,
          o.deliveryType,
          o.serviceAreaName,
          o.status,
          this.formatCurrency(o.subtotalCents),
          this.formatCurrency(o.discountCents),
          this.formatCurrency(o.taxCents),
          this.formatCurrency(o.totalCents),
          this.formatCurrency(o.balanceCents),
          this.formatDate(o.confirmedAt),
          this.formatDate(o.createdAt)
        ]);
        
        const csvContent = this.generateCsvContent(headers, rows);
        this.downloadCsv(`orders_export_${Date.now()}.csv`, csvContent);
        
      } else if (type === 'payments') {
        const obs = this.firestore.getCollection<any>('payments');
        const all = await firstValueFrom(obs);
        data = all.filter(item => !item.isDeleted);
        
        const headers = [
          'Payment ID', 'Payment Number', 'Order Number', 'Customer Name',
          'Amount', 'Method', 'Reference', 'Received Date', 'Created At'
        ];
        
        const rows = data.map(p => [
          p.id,
          p.paymentNumber,
          p.orderNumber,
          p.customerName,
          this.formatCurrency(p.amountCents),
          p.method,
          p.referenceNumber,
          p.receivedDate,
          this.formatDate(p.createdAt)
        ]);
        
        const csvContent = this.generateCsvContent(headers, rows);
        this.downloadCsv(`payments_export_${Date.now()}.csv`, csvContent);
        
      } else if (type === 'customers') {
        const obs = this.firestore.getCollection<any>('customers');
        const all = await firstValueFrom(obs);
        data = all.filter(item => !item.isDeleted);
        
        const headers = [
          'Customer ID', 'Business Name', 'Owner Name', 'Email', 'Phone',
          'Business Type', 'Service Area', 'Status', 'Total Ordered',
          'Total Owing', 'Created At'
        ];
        
        const rows = data.map(c => [
          c.id,
          c.businessName,
          [c.ownerFirstName, c.ownerLastName].filter(Boolean).join(' '),
          c.email,
          c.phone,
          c.businessType,
          c.serviceAreaName || c.serviceAreaCustom || '',
          c.status,
          this.formatCurrency(c.totalOrderedCents),
          this.formatCurrency(c.totalOwingCents),
          this.formatDate(c.createdAt)
        ]);
        
        const csvContent = this.generateCsvContent(headers, rows);
        this.downloadCsv(`customers_export_${Date.now()}.csv`, csvContent);
      }
      
      this.toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} exported successfully`);
    } catch (err) {
      console.error(err);
      this.toast.error(`Failed to export ${type}`);
    } finally {
      this.exporting.set(null);
    }
  }

  private generateCsvContent(headers: string[], rows: any[][]): string {
    const csvRows = [
      headers.map(h => this.escapeCsv(h)).join(','),
      ...rows.map(row => row.map(cell => this.escapeCsv(cell)).join(','))
    ];
    return csvRows.join('\r\n');
  }

  private escapeCsv(val: any): string {
    if (val === null || val === undefined) return '';
    let str = String(val);
    str = str.replace(/"/g, '""');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str}"`;
    }
    return str;
  }

  private formatCurrency(cents: number | undefined | null): string {
    if (cents === undefined || cents === null) return '$0.00';
    return '$' + (cents / 100).toFixed(2);
  }

  private formatDate(ts: any): string {
    if (!ts) return '';
    let date: Date;
    if (ts.toDate) {
      date = ts.toDate();
    } else if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else {
      date = new Date(ts);
    }
    if (isNaN(date.getTime())) return '';
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }

  private downloadCsv(filename: string, csvContent: string) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
}
