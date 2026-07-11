import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { Shop } from '../../../../core/models/shop.model';
import { serverTimestamp } from '@angular/fire/firestore';
import { normalizeSearchName } from '../../../../shared/utils/text.utils';
import { ShopLinkService } from '../../../../core/services/shop-link.service';
import { Customer } from '../../../../core/models/customer.model';

@Component({
  selector: 'app-shop-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LoadingSpinnerComponent],
  templateUrl: './shop-form.component.html',
  styleUrl: './shop-form.component.scss'
})
export class ShopFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly shopLink = inject(ShopLinkService);

  isEditMode = signal(false);
  isLoading = signal(false);
  isSaving = signal(false);
  isLocating = signal(false);
  shopId = signal<string | null>(null);
  shop = signal<Shop | null>(null);
  fromCustomerId = signal<string | null>(null);

  provinces = [
    { code: 'AB', name: 'Alberta' }, { code: 'BC', name: 'British Columbia' },
    { code: 'MB', name: 'Manitoba' }, { code: 'NB', name: 'New Brunswick' },
    { code: 'NL', name: 'Newfoundland and Labrador' }, { code: 'NS', name: 'Nova Scotia' },
    { code: 'NT', name: 'Northwest Territories' }, { code: 'NU', name: 'Nunavut' },
    { code: 'ON', name: 'Ontario' }, { code: 'PE', name: 'Prince Edward Island' },
    { code: 'QC', name: 'Quebec' }, { code: 'SK', name: 'Saskatchewan' }, { code: 'YT', name: 'Yukon' }
  ];

  statuses = [
    { value: 'prospect', label: 'Prospect' }, { value: 'customer', label: 'Customer' },
    { value: 'dormant', label: 'Dormant' }, { value: 'not_interested', label: 'Not Interested' }
  ];

  pipelineStages = [
    { value: 'first_contact', label: 'First Contact' }, { value: 'manager_meeting', label: 'Manager Meeting' },
    { value: 'sample_left', label: 'Sample Left' }, { value: 'decision', label: 'Decision' },
    { value: 'opened', label: 'Opened' }
  ];

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required]],
    ownerFirstName: [''],
    ownerLastName: [''],
    managerFirstName: [''],
    managerLastName: [''],
    phone: [''],
    bestVisitTime: [''],
    otherStoresOwned: [''],
    productsOfInterest: [''], // comma-separated -> string[]
    status: ['prospect', [Validators.required]],
    pipelineStage: ['first_contact'],
    address: this.fb.group({
      street: [''], city: [''], province: [''], postalCode: [''],
      country: [{ value: 'Canada', disabled: true }]
    }),
    lat: [null],
    lng: [null],
    notes: ['']
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) { this.isEditMode.set(true); this.shopId.set(id); this.loadShop(id); }
    else {
      const fromCustomer = this.route.snapshot.queryParamMap.get('fromCustomer');
      if (fromCustomer) { this.fromCustomerId.set(fromCustomer); this.prefillFromCustomer(fromCustomer); }
    }
  }

  private prefillFromCustomer(customerId: string) {
    this.firestore.getDocument<Customer>(`customers/${customerId}`).subscribe({
      next: (c) => {
        if (!c || c.isDeleted) return;
        this.form.patchValue({
          name: c.businessName,
          ownerFirstName: c.ownerFirstName || '',
          ownerLastName: c.ownerLastName || '',
          phone: c.phone || '',
          status: 'customer',
          address: {
            street: c.address?.street || '', city: c.address?.city || '',
            province: c.address?.province || '', postalCode: c.address?.postalCode || '',
            country: 'Canada',
          },
        });
      },
      error: (e) => console.error('Failed to prefill from customer', e),
    });
  }

  private loadShop(id: string) {
    this.isLoading.set(true);
    this.firestore.getDocument<Shop>(`shops/${id}`).subscribe({
      next: (data) => {
        if (!data || data.isDeleted) {
          this.toast.error('Shop not found'); this.router.navigate(['/admin/shops']); return;
        }
        this.shop.set(data);
        this.form.patchValue({
          name: data.name,
          ownerFirstName: data.ownerFirstName || '',
          ownerLastName: data.ownerLastName || '',
          managerFirstName: data.managerFirstName || '',
          managerLastName: data.managerLastName || '',
          phone: data.phone || '',
          bestVisitTime: data.bestVisitTime || '',
          otherStoresOwned: data.otherStoresOwned || '',
          productsOfInterest: (data.productsOfInterest || []).join(', '),
          status: data.status,
          pipelineStage: data.pipelineStage || 'first_contact',
          address: {
            street: data.address?.street || '', city: data.address?.city || '',
            province: data.address?.province || '', postalCode: data.address?.postalCode || '',
            country: 'Canada'
          },
          lat: data.coordinates?.lat ?? null,
          lng: data.coordinates?.lng ?? null,
          notes: data.notes || ''
        });
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load shop', err);
        this.toast.error('Failed to load shop'); this.router.navigate(['/admin/shops']);
      }
    });
  }

  useMyLocation() {
    if (!navigator.geolocation) { this.toast.error('Geolocation not supported on this device'); return; }
    this.isLocating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.form.patchValue({
          lat: +pos.coords.latitude.toFixed(6),
          lng: +pos.coords.longitude.toFixed(6)
        });
        this.isLocating.set(false);
        this.toast.success('Location captured');
      },
      (err) => {
        console.error('Geolocation error', err);
        this.toast.error('Could not get location — enter coordinates manually');
        this.isLocating.set(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  isInvalid(path: string): boolean {
    const c = this.form.get(path);
    return !!(c && c.invalid && (c.dirty || c.touched));
  }
  showPipeline(): boolean { return this.form.get('status')?.value === 'prospect'; }

  private buildPayload() {
    const val = this.form.getRawValue();
    const products = (val.productsOfInterest || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const hasAddress = val.address.street || val.address.city || val.address.province || val.address.postalCode;
    const hasCoords = val.lat != null && val.lng != null;
    return {
      name: val.name,
      searchName: normalizeSearchName(val.name),
      ownerFirstName: val.ownerFirstName || null,
      ownerLastName: val.ownerLastName || null,
      managerFirstName: val.managerFirstName || null,
      managerLastName: val.managerLastName || null,
      phone: val.phone || null,
      bestVisitTime: val.bestVisitTime || null,
      otherStoresOwned: val.otherStoresOwned || null,
      productsOfInterest: products,
      status: val.status,
      pipelineStage: val.status === 'prospect' ? val.pipelineStage : null,
      notes: val.notes || null,
      address: hasAddress ? {
        street: val.address.street || '', city: val.address.city || '',
        province: val.address.province || '', postalCode: val.address.postalCode || '', country: 'Canada'
      } : null,
      coordinates: hasCoords ? { lat: val.lat, lng: val.lng } : null,
    } as any;
  }

  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Please fix the errors in the form');
      return;
    }
    this.isSaving.set(true);
    try {
      const actionBy = this.auth.getActionBy();
      const payload = this.buildPayload();
      if (this.isEditMode() && this.shopId()) {
        await this.firestore.updateDocument(`shops/${this.shopId()}`, { ...payload, updatedAt: serverTimestamp() });
        this.toast.success('Shop updated');
        this.router.navigate(['/admin/shops', this.shopId()]);
      } else {
        const ref = await this.firestore.addDocument('shops', {
          ...payload, linkedCustomerId: null, hasCustomer: false, tenantId: 1, isDeleted: false,
          createdAt: serverTimestamp(), createdBy: actionBy
        });
        
        const fromCustomer = this.fromCustomerId();
        if (fromCustomer) {
          try { await this.shopLink.linkCustomerAndShop(fromCustomer, ref.id); }
          catch (e) { console.error('Auto-link to customer failed', e); this.toast.error('Shop saved, but linking to the customer failed — link it manually.'); }
        }

        this.toast.success('Shop added');
        this.router.navigate(['/admin/shops', ref.id]);
      }
    } catch (e) {
      console.error('Error saving shop', e);
      this.toast.error('Failed to save shop');
      this.isSaving.set(false);
    }
  }
}
