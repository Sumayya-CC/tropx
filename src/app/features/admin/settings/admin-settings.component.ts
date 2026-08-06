import { Component, inject, signal, effect, computed, untracked, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ToastService } from '../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SettingsService } from '../../../core/services/settings.service';
import { Storage } from '@angular/fire/storage';
import { toSignal } from '@angular/core/rxjs-interop';
import { where } from '@angular/fire/firestore';
import { StorefrontSettings, FeaturedBannerSlide, FeaturedBannerProduct, FeaturedBannerOverlay, BannerTextAlign, BannerTextColor, BannerProductPlacement, MAX_BANNER_PRODUCTS, resolveHidePrice } from '../../../core/models/storefront-settings.model';
import { Product } from '../../../core/models/product.model';
import { Functions, getFunctions, httpsCallable } from '@angular/fire/functions';

import { FirebaseApp } from '@angular/fire/app';
import { DEFAULT_HEALTH_THRESHOLDS } from '../../../shared/utils/shop-health.utils';
import { DEFAULT_STUCK_THRESHOLDS } from '../../../shared/utils/pipeline.utils';
import { BusinessInfoCardComponent } from './cards/business-info-card/business-info-card.component';
import { InvoiceSettingsCardComponent } from './cards/invoice-settings-card/invoice-settings-card.component';
import { OrderingDefaultsCardComponent } from './cards/ordering-defaults-card/ordering-defaults-card.component';
import { DeliveryOptionsCardComponent } from './cards/delivery-options-card/delivery-options-card.component';
import { PaymentMethodsCardComponent } from './cards/payment-methods-card/payment-methods-card.component';
import { StockBackorderCardComponent } from './cards/stock-backorder-card/stock-backorder-card.component';
import { MinimumOrderCardComponent } from './cards/minimum-order-card/minimum-order-card.component';
import { ClosureCardComponent } from './cards/closure-card/closure-card.component';
import { HomeSectionsCardComponent } from './cards/home-sections-card/home-sections-card.component';
import { GalleryCardComponent } from './cards/gallery-card/gallery-card.component';
import { PopularProductsCardComponent } from './cards/popular-products-card/popular-products-card.component';
type SettingsTab = 'business' | 'ordering' | 'storefront' | 'invoice' | 'notifications' | 'system';

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    BusinessInfoCardComponent,
    InvoiceSettingsCardComponent,
    OrderingDefaultsCardComponent,
    DeliveryOptionsCardComponent,
    PaymentMethodsCardComponent,
    StockBackorderCardComponent,
    MinimumOrderCardComponent,
    ClosureCardComponent,
    HomeSectionsCardComponent,
    GalleryCardComponent,
    PopularProductsCardComponent,
  ],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(Storage);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly functions2 = getFunctions(
    inject(FirebaseApp), 'northamerica-northeast2'
  );

  readonly TABS = ['business', 'ordering', 'storefront', 'invoice', 'notifications', 'system'] as const;
  activeTab = signal<SettingsTab>('business');



  protected readonly Math = Math;

  editingNotifications = signal(false);
  editingReconciliation = signal(false);
  editingShopLink = signal(false);
  editingShopHealth = signal(false);
  shHealthEnabled = signal(true);
  shCustomerWatch = signal(DEFAULT_HEALTH_THRESHOLDS.customerWatchDays);
  shCustomerAtRisk = signal(DEFAULT_HEALTH_THRESHOLDS.customerAtRiskDays);
  shProspectCooling = signal(DEFAULT_HEALTH_THRESHOLDS.prospectCoolingDays);
  shProspectCold = signal(DEFAULT_HEALTH_THRESHOLDS.prospectColdDays);

  editingPipeline = signal(false);
  plEnabled = signal(true);
  plToVisit = signal(DEFAULT_STUCK_THRESHOLDS.to_visit);
  plFirstContact = signal(DEFAULT_STUCK_THRESHOLDS.first_contact);
  plManagerMeeting = signal(DEFAULT_STUCK_THRESHOLDS.manager_meeting);
  plSampleLeft = signal(DEFAULT_STUCK_THRESHOLDS.sample_left);
  plDecision = signal(DEFAULT_STUCK_THRESHOLDS.decision);
  plOpened = signal(DEFAULT_STUCK_THRESHOLDS.opened);

  // Reconciliation form signals
  shopLinkReconEnabled = signal(true);
  isReconcilingLinks = signal(false);
  reconNotifyThresholdDollars = signal(1);
  reconAutoCorrectMaxDollars = signal(50);
  reconAutoCorrectEnabled = signal(true);
  reconNotifyAdmin = signal(true);

  // Routing form signals
  rtStarts = signal<{label:string;lat:number;lng:number}[]>([]);
  rtMaxWaypoints = signal(9);
  rtClusterRadius = signal(3);
  rtTravelMode = signal<'driving'|'walking'|'bicycling'>('driving');
  rtFuelPerKm = signal<number|null>(null);
  rtFuelPriceCentsPerLiter = signal<number|null>(null);
  rtDefaultCenter = signal<{lat:number;lng:number}>({lat: 43.4516, lng: -80.4925});
  editingRouting = signal(false);

  expDefaultFuel = signal(30); // dollars, converted to cents on save
  expFuelReminder = signal(true);
  expCategories = signal<{value: string; label: string; icon?: string}[]>([]);
  editingExpenses = signal(false);
  gettingLocation = signal(false);

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

  readonly MAX_BANNER_PRODUCTS = MAX_BANNER_PRODUCTS;
  isUploadingSlideImage = signal(false);

  private products$ = this.firestore.getCollection<Product>(
    'products',
    where('tenantId', '==', 1),
    where('isDeleted', '==', false)
  );
  activeProducts = toSignal(this.products$, { initialValue: [] as Product[] });



  isSaving = signal(false);

  filteredProductsForSlide = computed(() => {
    const q = this.productSearchQuery().toLowerCase().trim();
    const all = this.activeProducts();
    if (!q) return all;
    return all.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  });

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

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab') as SettingsTab | null;
      this.activeTab.set(
        tab && (this.TABS as readonly string[]).includes(tab) ? tab : 'business'
      );
    });

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
      this.shopLinkReconEnabled.set((r as any).shopLink?.enabled !== false);
      
      const sh = (r as any).shopHealth || {};
      this.shHealthEnabled.set(sh.enabled !== false);
      this.shCustomerWatch.set(sh.customerWatchDays ?? DEFAULT_HEALTH_THRESHOLDS.customerWatchDays);
      this.shCustomerAtRisk.set(sh.customerAtRiskDays ?? DEFAULT_HEALTH_THRESHOLDS.customerAtRiskDays);
      this.shProspectCooling.set(sh.prospectCoolingDays ?? DEFAULT_HEALTH_THRESHOLDS.prospectCoolingDays);
      this.shProspectCold.set(sh.prospectColdDays ?? DEFAULT_HEALTH_THRESHOLDS.prospectColdDays);
      
      const pl = (r as any).pipeline || {}; const st = pl.stuckThresholds || {};
      this.plEnabled.set(pl.enabled !== false);
      this.plToVisit.set(st.to_visit ?? DEFAULT_STUCK_THRESHOLDS.to_visit);
      this.plFirstContact.set(st.first_contact ?? DEFAULT_STUCK_THRESHOLDS.first_contact);
      this.plManagerMeeting.set(st.manager_meeting ?? DEFAULT_STUCK_THRESHOLDS.manager_meeting);
      this.plSampleLeft.set(st.sample_left ?? DEFAULT_STUCK_THRESHOLDS.sample_left);
      this.plDecision.set(st.decision ?? DEFAULT_STUCK_THRESHOLDS.decision);
      this.plOpened.set(st.opened ?? DEFAULT_STUCK_THRESHOLDS.opened);
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
    }, { allowSignalWrites: true });

    effect(() => {
      const rt = this.settings.routing();
      this.rtStarts.set([...(rt.startLocations || [])]);
      this.rtMaxWaypoints.set(rt.maxWaypointsPerLeg ?? 9);
      this.rtClusterRadius.set(rt.clusterRadiusKm ?? 3);
      this.rtTravelMode.set(rt.defaultTravelMode || 'driving');
      this.rtFuelPerKm.set(rt.vehicleFuelPerKm ?? null);
      this.rtFuelPriceCentsPerLiter.set(rt.fuelPriceCentsPerLiter ?? null);
      this.rtDefaultCenter.set(rt.defaultCenter ?? {lat: 43.4516, lng: -80.4925});
    }, { allowSignalWrites: true });

    effect(() => {
      const exp = this.settings.expenses();
      this.expDefaultFuel.set((exp.defaultFuelCents ?? 3000) / 100);
      this.expFuelReminder.set(exp.fuelReminderOnVisit ?? true);
      this.expCategories.set([...(exp.categories ?? [])]);
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

  protected readonly resolveHidePrice = resolveHidePrice;

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

  editingExistingSlideId = signal<string | null>(null);

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


  async saveShopHealth() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/reconciliation', {
        shopHealth: {
          enabled: this.shHealthEnabled(),
          customerWatchDays: this.shCustomerWatch(),
          customerAtRiskDays: this.shCustomerAtRisk(),
          prospectCoolingDays: this.shProspectCooling(),
          prospectColdDays: this.shProspectCold(),
        },
      });
      this.toast.success('Shop health thresholds saved');
      this.editingShopHealth.set(false);
    } catch (e) { console.error(e); this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelShopHealth() {
    const sh = (this.settings.reconciliation() as any).shopHealth || {};
    this.shHealthEnabled.set(sh.enabled !== false);
    this.shCustomerWatch.set(sh.customerWatchDays ?? DEFAULT_HEALTH_THRESHOLDS.customerWatchDays);
    this.shCustomerAtRisk.set(sh.customerAtRiskDays ?? DEFAULT_HEALTH_THRESHOLDS.customerAtRiskDays);
    this.shProspectCooling.set(sh.prospectCoolingDays ?? DEFAULT_HEALTH_THRESHOLDS.prospectCoolingDays);
    this.shProspectCold.set(sh.prospectColdDays ?? DEFAULT_HEALTH_THRESHOLDS.prospectColdDays);
    this.editingShopHealth.set(false);
  }

  async savePipeline() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/reconciliation', {
        pipeline: {
          enabled: this.plEnabled(),
          stuckThresholds: {
            to_visit: this.plToVisit(),
            first_contact: this.plFirstContact(),
            manager_meeting: this.plManagerMeeting(),
            sample_left: this.plSampleLeft(),
            decision: this.plDecision(),
            opened: this.plOpened(),
          },
        },
      });
      this.toast.success('Pipeline settings saved');
      this.editingPipeline.set(false);
    } catch (e) { console.error(e); this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelPipeline() {
    const pl = (this.settings.reconciliation() as any).pipeline || {}; const st = pl.stuckThresholds || {};
    this.plEnabled.set(pl.enabled !== false);
    this.plToVisit.set(st.to_visit ?? DEFAULT_STUCK_THRESHOLDS.to_visit);
    this.plFirstContact.set(st.first_contact ?? DEFAULT_STUCK_THRESHOLDS.first_contact);
    this.plManagerMeeting.set(st.manager_meeting ?? DEFAULT_STUCK_THRESHOLDS.manager_meeting);
    this.plSampleLeft.set(st.sample_left ?? DEFAULT_STUCK_THRESHOLDS.sample_left);
    this.plDecision.set(st.decision ?? DEFAULT_STUCK_THRESHOLDS.decision);
    this.plOpened.set(st.opened ?? DEFAULT_STUCK_THRESHOLDS.opened);
    this.editingPipeline.set(false);
  }

  async saveRouting() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/routing', {
        startLocations: this.rtStarts(),
        maxWaypointsPerLeg: this.rtMaxWaypoints(),
        clusterRadiusKm: this.rtClusterRadius(),
        defaultTravelMode: this.rtTravelMode(),
        vehicleFuelPerKm: this.rtFuelPerKm(),
        fuelPriceCentsPerLiter: this.rtFuelPriceCentsPerLiter(),
        defaultCenter: this.rtDefaultCenter(),
      });
      this.toast.success('Routing settings saved');
      this.editingRouting.set(false);
    } catch (e) { console.error(e); this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelRouting() {
    const rt = this.settings.routing();
    this.rtStarts.set([...(rt.startLocations || [])]);
    this.rtMaxWaypoints.set(rt.maxWaypointsPerLeg ?? 9);
    this.rtClusterRadius.set(rt.clusterRadiusKm ?? 3);
    this.rtTravelMode.set(rt.defaultTravelMode || 'driving');
    this.rtFuelPerKm.set(rt.vehicleFuelPerKm ?? null);
    this.rtFuelPriceCentsPerLiter.set(rt.fuelPriceCentsPerLiter ?? null);
    this.rtDefaultCenter.set(rt.defaultCenter ?? {lat: 43.4516, lng: -80.4925});
    this.editingRouting.set(false);
  }

  addRoutingStart() {
    this.rtStarts.update(s => [...s, { label: '', lat: 0, lng: 0 }]);
  }
  removeRoutingStart(idx: number) {
    this.rtStarts.update(s => s.filter((_, i) => i !== idx));
  }

  async saveExpenses() {
    this.isSaving.set(true);
    try {
      await this.firestore.setDocument('settings/expenses', {
        defaultFuelCents: Math.round(this.expDefaultFuel() * 100),
        fuelReminderOnVisit: this.expFuelReminder(),
        categories: this.expCategories(),
      });
      this.toast.success('Expense settings saved');
      this.editingExpenses.set(false);
    } catch (e) { console.error(e); this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelExpenses() {
    const exp = this.settings.expenses();
    this.expDefaultFuel.set((exp.defaultFuelCents ?? 3000) / 100);
    this.expFuelReminder.set(exp.fuelReminderOnVisit ?? true);
    this.expCategories.set([...(exp.categories ?? [])]);
    this.editingExpenses.set(false);
  }

  addExpenseCategory() {
    this.expCategories.update(c => [...c, { value: '', label: '', icon: '' }]);
  }
  removeExpenseCategory(idx: number) {
    this.expCategories.update(c => c.filter((_, i) => i !== idx));
  }
  updateExpenseCategoryLabel(idx: number, label: string) {
    this.expCategories.update(c => c.map((cat, i) => i === idx
      ? { ...cat, label, value: cat.value || label.trim().toLowerCase().replace(/\s+/g, '_') }
      : cat));
  }
  updateExpenseCategoryIcon(idx: number, icon: string) {
    this.expCategories.update(c => c.map((cat, i) => i === idx ? { ...cat, icon } : cat));
  }

  useCurrentLocation(rowIndex: number) {
    if (!navigator.geolocation) { this.toast.error('Geolocation not available'); return; }
    this.gettingLocation.set(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        this.rtStarts.update(list => list.map((r, i) =>
          i === rowIndex ? { ...r, lat: +latitude.toFixed(6), lng: +longitude.toFixed(6) } : r));
        this.gettingLocation.set(false);
        this.toast.success('Location captured');
      },
      err => { console.error(err); this.gettingLocation.set(false); this.toast.error('Could not get location'); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  useCurrentLocationForCenter() {
    if (!navigator.geolocation) { this.toast.error('Geolocation not available'); return; }
    this.gettingLocation.set(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        this.rtDefaultCenter.set({ lat: +latitude.toFixed(6), lng: +longitude.toFixed(6) });
        this.gettingLocation.set(false);
        this.toast.success('Location captured');
      },
      err => { console.error(err); this.gettingLocation.set(false); this.toast.error('Could not get location'); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
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
      await this.firestore.updateDocument(
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

  editShopLink() {
    this.editingShopLink.set(true);
  }

  cancelShopLink() {
    const r = this.settings.reconciliation() as any;
    this.shopLinkReconEnabled.set(r.shopLink?.enabled !== false);
    this.editingShopLink.set(false);
  }

  async saveShopLink() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/reconciliation', {
        shopLink: { enabled: this.shopLinkReconEnabled() },
      });
      this.toast.success('Shop ↔ customer linking settings saved');
      this.editingShopLink.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save linking settings');
    } finally {
      this.isSaving.set(false);
    }
  }

  async reconcileLinksNow() {
    this.isReconcilingLinks.set(true);
    try {
      const fn = httpsCallable(this.functions2, 'reconcileShopLinksNow');
      const res: any = await fn({});
      const d = res.data || {};
      this.toast.success(
        `Reconciled: ${d.healed ?? 0} healed, ${d.flagged ?? 0} need review, ` +
        `${d.backfilled ?? 0} backfilled (scanned ${d.scanned ?? 0})`
      );
    } catch (err) {
      console.error('Link reconcile failed', err);
      this.toast.error('Reconcile failed — check console');
    } finally {
      this.isReconcilingLinks.set(false);
    }
  }

}
