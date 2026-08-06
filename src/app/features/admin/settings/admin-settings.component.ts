import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
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
import { ReconciliationCardComponent } from './cards/reconciliation-card/reconciliation-card.component';
import { ShopLinkCardComponent } from './cards/shop-link-card/shop-link-card.component';
import { ShopHealthCardComponent } from './cards/shop-health-card/shop-health-card.component';
import { PipelineCardComponent } from './cards/pipeline-card/pipeline-card.component';
import { RoutingCardComponent } from './cards/routing-card/routing-card.component';
import { ExpensesCardComponent } from './cards/expenses-card/expenses-card.component';
type SettingsTab = 'business' | 'ordering' | 'storefront' | 'invoice' | 'notifications' | 'system';

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
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
    ReconciliationCardComponent,
    ShopLinkCardComponent,
    ShopHealthCardComponent,
    PipelineCardComponent,
    RoutingCardComponent,
    ExpensesCardComponent,
  ],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly TABS = ['business', 'ordering', 'storefront', 'invoice', 'notifications', 'system'] as const;
  activeTab = signal<SettingsTab>('business');

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab') as SettingsTab | null;
      this.activeTab.set(
        tab && (this.TABS as readonly string[]).includes(tab) ? tab : 'business'
      );
    });
  }

  setActiveTab(tab: SettingsTab) {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
  }
}
