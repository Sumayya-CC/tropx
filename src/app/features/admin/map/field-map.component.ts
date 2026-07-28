import { Component, inject, signal, computed, afterNextRender, ElementRef, viewChild, OnDestroy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { SettingsService } from '../../../core/services/settings.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { Shop } from '../../../core/models/shop.model';
import { RouteSelectionService } from '../../../core/services/route-selection.service';

type PinFilter = 'all' | 'customers' | 'prospects' | 'attention';

@Component({
  selector: 'app-field-map',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, RouterLink],
  templateUrl: './field-map.component.html',
  styleUrl: './field-map.component.scss',
})
export class FieldMapComponent implements OnDestroy {
  private readonly firestore = inject(FirestoreService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly selection = inject(RouteSelectionService);
  private readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  shops = signal<Shop[]>([]);
  filter = signal<PinFilter>('all');
  private map: any = null;
  private L: any = null;
  private markers: any[] = [];

  legend = computed(() => {
    const s = this.shops();
    const withCoords = s.filter(x => (x.coordinates as any)?.lat && (x.coordinates as any)?.lng);
    const customers = withCoords.filter(x => x.status === 'customer');
    return {
      active: customers.filter(x => x.healthBand === 'healthy').length,
      watch: customers.filter(x => x.healthBand === 'watch').length,
      dormant: customers.filter(x => x.healthBand === 'at_risk').length,
      prospects: withCoords.filter(x => x.status === 'prospect').length,
      missing: s.length - withCoords.length,
    };
  });
  
  selectedCount = computed(() => this.selection.count());

  constructor() {
    // Load shops (stream).
    this.firestore.getCollection<Shop>(
      'shops', where('tenantId', '==', 1), where('isDeleted', '==', false),
    ).pipe(takeUntilDestroyed()).subscribe(d => { this.shops.set(d); this.renderPins(); });

    // Browser-only Leaflet init — afterNextRender never runs during SSR/prerender.
    afterNextRender(async () => {
      const leaflet = await import('leaflet');
      this.L = (leaflet as any).default ?? leaflet;
      this.fixMarkerIcons();
      const el = this.mapEl()?.nativeElement;
      if (!el) return;
      this.map = this.L.map(el);
      const dc = (this.settings.routing() as any)?.defaultCenter;
      this.map.setView([dc?.lat ?? 43.4516, dc?.lng ?? -80.4925], 11);
      this.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(this.map);
      this.renderPins();
    });
  }

  ngOnDestroy() {
    if (this.map) { this.map.remove(); this.map = null; }
  }

  // The classic Leaflet + bundler broken-marker-icon fix: Leaflet's default icon URLs don't
  // survive bundling. We build colored divIcons ourselves, so we don't rely on the image assets —
  // but this also neutralizes the broken default icon if any default marker slips through.
  private fixMarkerIcons() {
    // No-op for divIcons; kept as the hook if you later use L.icon with image assets.
  }

  private colorFor(shop: Shop): string {
    if (shop.status === 'prospect') return '#0891b2';        // cyan
    if (shop.status === 'not_interested' || shop.status === 'dormant') return '#9ca3af'; // grey
    // customer → health band
    switch (shop.healthBand) {
      case 'healthy': return '#1a7c4a';   // green
      case 'watch': return '#c9952a';     // amber
      case 'at_risk': return '#e7222e';   // red
      default: return '#1a7c4a';
    }
  }

  private divIcon(color: string) {
    return this.L.divIcon({
      className: 'fm-pin',
      html: `<span style="background:${color}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -9],
    });
  }

  private passesFilter(shop: Shop): boolean {
    const f = this.filter();
    if (f === 'customers') return shop.status === 'customer';
    if (f === 'prospects') return shop.status === 'prospect';
    if (f === 'attention') return shop.status === 'customer' && shop.healthBand === 'at_risk';
    return true;
  }

  private renderPins() {
    if (!this.map || !this.L) return;
    for (const m of this.markers) this.map.removeLayer(m);
    this.markers = [];
    for (const shop of this.shops()) {
      const c: any = shop.coordinates;
      if (!c?.lat || !c?.lng) continue;
      if (!this.passesFilter(shop)) continue;
      const marker = this.L.marker([c.lat, c.lng], { icon: this.divIcon(this.colorFor(shop)) })
        .addTo(this.map);
      const daysBand = shop.healthBand ? `${shop.healthBand}` : '—';
      const statusLine = shop.status === 'customer' ? `Customer · ${daysBand}` : `Prospect`;
      
      const selected = this.selection.has(shop.id);
      const html = `
        <div class="fm-popup">
          <div class="fm-popup-name">${escapeHtml(shop.name)}</div>
          <div class="fm-popup-status">${statusLine}</div>
          <div class="fm-popup-actions">
            <a href="/admin/shops/${shop.id}">View Shop</a>
            <button class="fm-add-btn" data-shop-id="${shop.id}">
              ${selected ? '✓ Added' : '+ Add to Route'}
            </button>
          </div>
        </div>`;
      marker.bindPopup(html);
      marker.on('popupopen', (e: any) => {
        const node: HTMLElement = e.popup.getElement();
        const btn = node?.querySelector('.fm-add-btn') as HTMLButtonElement | null;
        if (!btn) return;
        btn.onclick = () => {
          this.selection.toggle(shop.id);
          btn.textContent = this.selection.has(shop.id) ? '✓ Added' : '+ Add to Route';
          btn.classList.toggle('added', this.selection.has(shop.id));
          // reflect ring on the marker
          this.markStyle(marker, shop);
        };
      });
      // initial selected style
      this.markStyle(marker, shop);
      this.markers.push(marker);
    }
    if (this.markers.length && this.map) {
      const group = this.L.featureGroup(this.markers);
      try { this.map.fitBounds(group.getBounds().pad(0.15)); } catch { /* single point */ }
    }
  }

  setFilter(f: PinFilter) { this.filter.set(f); this.renderPins(); }

  private markStyle(marker: any, shop: Shop) {
    const el = marker.getElement?.();
    if (!el) return;
    el.classList.toggle('fm-selected', this.selection.has(shop.id));
  }

  planRoute() {
    if (this.selection.count() === 0) return;
    this.router.navigate(['/admin/route']);
  }
  clearSelection() { this.selection.clear(); this.renderPins(); }
}

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, ch => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' } as any)[ch]);
}
