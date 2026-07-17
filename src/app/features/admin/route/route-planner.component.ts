import { Component, inject, signal, computed, afterNextRender, ElementRef, viewChild, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { RoutingService } from '../../../core/services/routing.service';
import { SettingsService } from '../../../core/services/settings.service';
import { ToastService } from '../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteStop, LatLng, findNearbyShops } from '../../../shared/utils/geo.utils';
import { RouteSelectionService } from '../../../core/services/route-selection.service';
import { DecimalPipe } from '@angular/common';

type Mode = 'delivery' | 'visit';

@Component({
  selector: 'app-route-planner',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, DecimalPipe],
  templateUrl: './route-planner.component.html',
  styleUrl: './route-planner.component.scss',
})
export class RoutePlannerComponent implements OnDestroy {
  private readonly firestore = inject(FirestoreService);
  private readonly routing = inject(RoutingService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly selection = inject(RouteSelectionService);
  private readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  mode = signal<Mode>('delivery');
  serviceAreas = signal<{ id: string; name: string }[]>([]);
  selectedAreaIds = signal<string[]>([]);
  returnToStart = signal(true);
  forceCoordinates = signal(false);

  // start point
  startChoice = signal<'saved' | 'current'>('saved');
  savedStarts = signal<{ label: string; lat: number; lng: number }[]>([]);
  selectedStartIdx = signal(0);
  currentLoc = signal<LatLng | null>(null);

  allStops = signal<RouteStop[]>([]);      // candidates pulled from areas/mode
  manualStops = signal<RouteStop[]>([]);   // manually added
  optimized = signal<RouteStop[]>([]);
  totalKm = signal(0);
  busy = signal(false);

  templates = signal<any[]>([]);
  templateName = signal('');
  confirmDeleteTpl = signal<string | null>(null);

  // manual add search
  shopSearch = signal('');
  private allShopsCache = signal<RouteStop[]>([]);

  private L: any = null; private map: any = null; private layers: any[] = [];

  maxWaypoints = computed(() => (this.settings.routing?.() as any)?.maxWaypointsPerLeg ?? 9);
  travelMode = computed(() => (this.settings.routing?.() as any)?.defaultTravelMode ?? 'driving');
  clusterRadiusKm = computed(() => (this.settings.routing?.() as any)?.clusterRadiusKm ?? 3);

  legs = computed(() => {
    const start = this.startPoint();
    if (!start || this.optimized().length === 0) return [];
    return this.routing.navigationLegs(start, this.optimized(), this.maxWaypoints(), this.travelMode(), this.returnToStart(), this.forceCoordinates());
  });

  nearby = computed(() => {
    if (this.optimized().length === 0) return { prospects: [], customers: [] };
    const inRoute = new Set(this.optimized().map(s => s.id));
    const candidates = this.allShopsCache().filter(s => !inRoute.has(s.id) && this.validCoord(s));
    const found = findNearbyShops(this.optimized(), candidates, this.clusterRadiusKm());
    return {
      prospects: found.filter(x => x.shop.kind === 'prospect'),
      customers: found.filter(x => x.shop.kind === 'customer'),
    };
  });

  atRiskOnRoute = computed(() =>
    this.optimized().filter(s => s.kind === 'customer' && s.healthBand === 'at_risk')
  );

  constructor() {
    // service areas
    this.firestore.getCollection<any>('serviceAreas',
      where('tenantId','==',1), where('isDeleted','==',false),
    ).subscribe(d => this.serviceAreas.set(d.map((a:any)=>({id:a.id,name:a.name}))));

    // saved starts from settings
    const starts = ((this.settings.routing?.() as any)?.startLocations) || [];
    this.savedStarts.set(starts);

    // cache all shops for manual add
    this.routing.visitStops(null).then(s => {
      this.allShopsCache.set(s);
      const pending = this.selection.pendingShopIds();
      if (pending.length) {
        const picked = pending.map(id => s.find(x => x.id === id)).filter(Boolean) as RouteStop[];
        if (picked.length) {
          this.mode.set('visit');
          this.manualStops.set(picked);
          this.toast.success(`${picked.length} shop${picked.length===1?'':'s'} loaded from map`);
        }
        this.selection.clear();
      }
    });

    this.firestore.getCollection<any>('routeTemplates', where('tenantId','==',1), where('isDeleted','==',false))
      .subscribe(d => this.templates.set(d));

    afterNextRender(async () => {
      const leaflet = await import('leaflet');
      this.L = (leaflet as any).default ?? leaflet;
      const el = this.mapEl()?.nativeElement; if (!el) return;
      this.map = this.L.map(el).setView([43.4516, -80.4925], 11);
      this.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(this.map);
    });
  }
  ngOnDestroy(){ if (this.map){ this.map.remove(); this.map=null; } }

  startPoint(): LatLng | null {
    if (this.startChoice() === 'current') return this.currentLoc();
    const s = this.savedStarts()[this.selectedStartIdx()];
    return s ? { lat: s.lat, lng: s.lng } : null;
  }

  useCurrentLocation() {
    if (!navigator.geolocation) { this.toast.error('Geolocation unavailable'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { this.currentLoc.set({ lat: pos.coords.latitude, lng: pos.coords.longitude }); this.startChoice.set('current'); this.toast.success('Using current location'); },
      () => this.toast.error('Could not get location'),
      { enableHighAccuracy: true, timeout: 10000 });
  }

  toggleArea(id: string) {
    this.selectedAreaIds.update(list => list.includes(id) ? list.filter(x=>x!==id) : [...list, id]);
  }

  async pullStops() {
    this.busy.set(true);
    try {
      const areas = this.selectedAreaIds().length ? this.selectedAreaIds() : null;
      const stops = this.mode() === 'delivery'
        ? await this.routing.deliveryStops(areas)
        : await this.routing.visitStops(areas);
      this.allStops.set(stops);
      this.toast.success(`${stops.length} stop${stops.length===1?'':'s'} loaded`);
    } catch(e){ console.error(e); this.toast.error('Failed to load stops'); }
    finally { this.busy.set(false); }
  }

  searchResults = computed(() => {
    const q = this.shopSearch().trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set([...this.allStops(), ...this.manualStops()].map(s=>s.id));
    return this.allShopsCache().filter(s => !chosen.has(s.id) && s.name.toLowerCase().includes(q)).slice(0,8);
  });
  addManual(stop: RouteStop){ this.manualStops.update(l=>[...l, stop]); this.shopSearch.set(''); }
  removeStop(id: string){
    this.allStops.update(l=>l.filter(s=>s.id!==id));
    this.manualStops.update(l=>l.filter(s=>s.id!==id));
    this.optimized.update(l=>l.filter(s=>s.id!==id));
  }

  async toggleStopCoords(stop: RouteStop, ev: Event) {
    ev.stopPropagation();
    const next = !stop.preferCoordinatesForNav;
    const flip = (arr: RouteStop[]) => arr.map(s => s.id === stop.id
      ? { ...s, preferCoordinatesForNav: next } : s);
    this.allStops.update(flip); this.manualStops.update(flip); this.optimized.update(flip);
    
    try {
      const writes: Promise<any>[] = [];
      if (stop.kind === 'customer') {
        writes.push(this.firestore.updateDocument(`customers/${stop.id}`, { preferCoordinatesForNav: next }));
        if (stop.linkedShopId) writes.push(this.firestore.updateDocument(`shops/${stop.linkedShopId}`, { preferCoordinatesForNav: next }));
      } else {
        writes.push(this.firestore.updateDocument(`shops/${stop.id}`, { preferCoordinatesForNav: next }));
        if (stop.linkedCustomerId) writes.push(this.firestore.updateDocument(`customers/${stop.linkedCustomerId}`, { preferCoordinatesForNav: next }));
      }
      await Promise.all(writes);
      this.toast.success(next ? 'Will use coordinates for this shop' : 'Will use address for this shop');
    } catch (e) {
      console.error(e);
      this.toast.error('Could not save preference');
    }
  }

  private validCoord(s: RouteStop): boolean {
    const c: any = s.coordinates;
    return c && typeof c.lat === 'number' && typeof c.lng === 'number' && !isNaN(c.lat) && !isNaN(c.lng);
  }

  combinedStops = computed(() => {
    const seen = new Set<string>(); const out: RouteStop[] = [];
    for (const s of [...this.allStops(), ...this.manualStops()]) {
      if (!seen.has(s.id) && this.validCoord(s)) { seen.add(s.id); out.push(s); }
    }
    return out;
  });

  excludedStops = computed(() => {
    const seen = new Set<string>(); const out: RouteStop[] = [];
    for (const s of [...this.allStops(), ...this.manualStops()]) {
      if (!seen.has(s.id) && !this.validCoord(s)) { seen.add(s.id); out.push(s); }
    }
    return out;
  });

  optimize() {
    const start = this.startPoint();
    if (!start) { this.toast.error('Pick a start location'); return; }
    const stops = this.combinedStops();
    if (stops.length === 0) { this.toast.error('No stops to route'); return; }
    const ordered = this.routing.optimize(start, stops, this.returnToStart());
    this.optimized.set(ordered);
    this.totalKm.set(this.routing.distanceKm(start, ordered, this.returnToStart()));
    this.drawRoute(start, ordered);
  }

  private drawRoute(start: LatLng, ordered: RouteStop[]) {
    if (!this.map || !this.L) return;
    for (const l of this.layers) this.map.removeLayer(l); this.layers = [];
    // start marker
    const startM = this.L.circleMarker([start.lat, start.lng], { radius:9, color:'#fff', weight:2, fillColor:'#e7222e', fillOpacity:1 }).addTo(this.map);
    startM.bindPopup('<b>Start</b>');
    this.layers.push(startM);
    // numbered stop markers
    ordered.forEach((s, i) => {
      const bg = s.kind === 'prospect' ? '#0891b2' : '#0a2d4a';
      const icon = this.L.divIcon({ className:'rp-pin', html:`<span style="background:${bg}">${i+1}</span>`, iconSize:[24,24], iconAnchor:[12,12] });
      const m = this.L.marker([s.coordinates.lat, s.coordinates.lng], { icon }).addTo(this.map);
      m.bindPopup(`<b>${i+1}. ${s.name}</b>`);
      this.layers.push(m);
    });
    // polyline start → stops (→ start)
    const pts = [[start.lat,start.lng], ...ordered.map(s=>[s.coordinates.lat,s.coordinates.lng])];
    if (this.returnToStart()) pts.push([start.lat,start.lng]);
    const line = this.L.polyline(pts, { color:'#0a2d4a', weight:4, opacity:.7 }).addTo(this.map);
    this.layers.push(line);
    try { this.map.fitBounds(line.getBounds().pad(0.15)); } catch {}
  }

  addInfillToRoute(p: RouteStop) { 
    this.manualStops.update(l=>[...l,p]); 
    this.optimize(); 
  }

  async saveTemplate() {
    const name = this.templateName().trim();
    if (!name) { this.toast.error('Name the route'); return; }
    const stopIds = this.combinedStops().map(s => s.id);
    if (!stopIds.length) { this.toast.error('No stops'); return; }
    await this.firestore.addDocument('routeTemplates', {
      name, mode: this.mode(), stopIds, serviceAreaIds: this.selectedAreaIds(),
      returnToStart: this.returnToStart(), tenantId: 1, isDeleted: false, createdAt: new Date(),
    });
    this.toast.success('Route saved'); this.templateName.set('');
  }

  async loadTemplate(t: any) {
    this.mode.set(t.mode || 'delivery');
    this.selectedAreaIds.set(t.serviceAreaIds || []);
    this.returnToStart.set(t.returnToStart !== false);
    const cache = this.allShopsCache();
    const stops = (t.stopIds || []).map((id:string)=>cache.find(s=>s.id===id)).filter(Boolean);
    this.manualStops.set(stops); this.allStops.set([]);
    this.toast.success(`Loaded "${t.name}"`); this.optimize();
  }

  async deleteTemplate(t:any){ await this.firestore.updateDocument(`routeTemplates/${t.id}`, { isDeleted:true }); }

  askDeleteTemplate(id: string, ev: Event){ ev.stopPropagation(); this.confirmDeleteTpl.set(id); }
  cancelDeleteTpl(){ this.confirmDeleteTpl.set(null); }
  async doDeleteTemplate(t: any){
    await this.firestore.updateDocument(`routeTemplates/${t.id}`, { isDeleted:true });
    this.confirmDeleteTpl.set(null);
    this.toast.success('Route deleted');
  }

  printSheet() {
    const rows = this.optimized().map((s,i)=>`
      <tr><td>${i+1}</td><td>${s.name}</td><td></td><td style="width:120px;border-bottom:1px solid #000;"></td></tr>`).join('');
    const html = `<html><head><title>Route Sheet</title>
      <style>body{font-family:sans-serif;padding:24px;} h1{font-size:18px;} table{width:100%;border-collapse:collapse;margin-top:12px;}
      th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:14px;} th{background:#0a2d4a;color:#fff;}</style></head>
      <body><h1>Route Sheet — ${new Date().toLocaleDateString('en-CA')}</h1>
      <p>${this.optimized().length} stops · ${this.totalKm().toFixed(1)} km</p>
      <table><thead><tr><th>#</th><th>Shop</th><th>Notes</th><th>Done</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`;
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  openLeg(url: string){ window.open(url, '_blank'); }
}
