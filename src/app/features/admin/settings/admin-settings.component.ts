import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ToastService } from '../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SettingsService } from '../../../core/services/settings.service';
import { Storage } from '@angular/fire/storage';
import { getFunctions, httpsCallable } from '@angular/fire/functions';

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
import { FeaturedBannerCardComponent } from './cards/featured-banner-card/featured-banner-card.component';
import { NotificationsCardComponent } from './cards/notifications-card/notifications-card.component';
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
    FeaturedBannerCardComponent,
    NotificationsCardComponent,
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

  isSaving = signal(false);

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab') as SettingsTab | null;
      this.activeTab.set(
        tab && (this.TABS as readonly string[]).includes(tab) ? tab : 'business'
      );
    });

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
