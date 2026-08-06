import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-routing-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './routing-card.component.html',
})
export class RoutingCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  protected readonly Math = Math;

  editingRouting = signal(false);
  isSaving = signal(false);
  gettingLocation = signal(false);

  rtStarts = signal<{label:string;lat:number;lng:number}[]>([]);
  rtMaxWaypoints = signal(9);
  rtClusterRadius = signal(3);
  rtTravelMode = signal<'driving'|'walking'|'bicycling'>('driving');
  rtFuelPerKm = signal<number|null>(null);
  rtFuelPriceCentsPerLiter = signal<number|null>(null);
  rtDefaultCenter = signal<{lat:number;lng:number}>({lat: 43.4516, lng: -80.4925});

  constructor() {
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
}
