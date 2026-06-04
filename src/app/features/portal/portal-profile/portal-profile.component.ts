import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { PortalService } from '../../../core/services/portal.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../shared/services/toast.service';

@Component({
  selector: 'app-portal-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './portal-profile.component.html',
  styleUrl: './portal-profile.component.scss'
})
export class PortalProfileComponent {
  protected readonly portal = inject(PortalService);
  private readonly firestoreService = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly storage = inject(Storage);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  isLoading = signal(true);
  isSaving = signal(false);
  isUploadingLogo = signal(false);
  isDirty = signal(false);
  private formLoaded = signal(false);
  isEditMode = signal(false);

  enterEditMode() {
    this.isEditMode.set(true);
  }

  exitEditMode() {
    this.cancel(); // resets form fields
    this.isEditMode.set(false);
    this.errors.set({});
  }

  // Form fields
  businessName = signal('');
  ownerName = signal('');
  phone = signal('');
  street = signal('');
  city = signal('');
  province = signal('');
  postalCode = signal('');
  logoUrl = signal<string | null>(null);

  // Validation errors
  errors = signal<Record<string, string>>({});

  canadianProvinces = [
    { code: 'AB', name: 'Alberta' },
    { code: 'BC', name: 'British Columbia' },
    { code: 'MB', name: 'Manitoba' },
    { code: 'NB', name: 'New Brunswick' },
    { code: 'NL', name: 'Newfoundland and Labrador' },
    { code: 'NS', name: 'Nova Scotia' },
    { code: 'NT', name: 'Northwest Territories' },
    { code: 'NU', name: 'Nunavut' },
    { code: 'ON', name: 'Ontario' },
    { code: 'PE', name: 'Prince Edward Island' },
    { code: 'QC', name: 'Quebec' },
    { code: 'SK', name: 'Saskatchewan' },
    { code: 'YT', name: 'Yukon' },
  ];

  customerEmail = computed(() =>
    this.portal.customerProfile()?.email || ''
  );

  provinceName = computed(() => {
    const code = this.province();
    const prov = this.canadianProvinces.find(p => p.code === code);
    return prov ? prov.name : code;
  });

  customerSince = computed(() => {
    const profile = this.portal.customerDoc();
    if (!profile?.createdAt) return '—';
    const d = profile.createdAt.toDate
      ? profile.createdAt.toDate()
      : new Date(profile.createdAt);
    return d.toLocaleDateString('en-CA', {
      month: 'long', year: 'numeric'
    });
  });

  customerStatus = computed(() =>
    this.portal.customerDoc()?.status || 'active'
  );

  constructor() {
    // Load customer data into form signals once
    effect(() => {
      const doc = this.portal.customerDoc();
      if (doc && !this.formLoaded()) {
        this.businessName.set(doc.businessName || '');
        this.ownerName.set(doc.ownerName || '');
        this.phone.set(doc.phone || '');
        this.street.set(doc.address?.street || '');
        this.city.set(doc.address?.city || '');
        this.province.set(doc.address?.province || '');
        this.postalCode.set(doc.address?.postalCode || '');
        this.logoUrl.set(doc.logoUrl || null);
        this.formLoaded.set(true);
        this.isLoading.set(false);
        this.isDirty.set(false);
      }
    });
  }

  markDirty() {
    this.isDirty.set(true);
  }

  // Canadian postal code validation A1A 1A1
  private validatePostalCode(code: string): boolean {
    const clean = code.trim().toUpperCase().replace(/\s/g, '');
    return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(clean);
  }

  formatPostalCode(raw: string): string {
    const clean = raw.trim().toUpperCase().replace(/\s/g, '');
    if (clean.length >= 3) {
      return clean.slice(0, 3) + ' ' + clean.slice(3, 6);
    }
    return clean;
  }

  validate(): boolean {
    const errs: Record<string, string> = {};

    if (!this.businessName().trim()) {
      errs['businessName'] = 'Business name is required';
    }
    if (!this.ownerName().trim()) {
      errs['ownerName'] = 'Owner name is required';
    }
    if (!this.street().trim()) {
      errs['street'] = 'Street address is required';
    }
    if (!this.city().trim()) {
      errs['city'] = 'City is required';
    }
    if (!this.province()) {
      errs['province'] = 'Province is required';
    }
    if (!this.postalCode().trim()) {
      errs['postalCode'] = 'Postal code is required';
    } else if (!this.validatePostalCode(this.postalCode())) {
      errs['postalCode'] = 'Enter a valid postal code (e.g. K1A 0A9)';
    }

    this.errors.set(errs);
    return Object.keys(errs).length === 0;
  }

  async save() {
    if (!this.validate()) {
      this.toast.error('Please fix the errors before saving');
      return;
    }

    const customerId = this.portal.linkedCustomerId();
    if (!customerId) return;

    this.isSaving.set(true);
    try {
      await this.firestoreService.updateDocument(
        `customers/${customerId}`,
        {
          businessName: this.businessName().trim(),
          ownerName: this.ownerName().trim(),
          phone: this.phone().trim(),
          address: {
            street: this.street().trim(),
            city: this.city().trim(),
            province: this.province(),
            postalCode: this.formatPostalCode(this.postalCode()),
            country: 'Canada',
          },
          logoUrl: this.logoUrl() || null,
        }
      );
      this.isDirty.set(false);
      this.isEditMode.set(false);
      this.toast.success('Profile updated successfully');
    } catch (err) {
      console.error('Profile save error:', err);
      this.toast.error('Failed to save profile');
    } finally {
      this.isSaving.set(false);
    }
  }

  cancel() {
    // Reset form to current doc values
    const doc = this.portal.customerDoc();
    if (doc) {
      this.businessName.set(doc.businessName || '');
      this.ownerName.set(doc.ownerName || '');
      this.phone.set(doc.phone || '');
      this.street.set(doc.address?.street || '');
      this.city.set(doc.address?.city || '');
      this.province.set(doc.address?.province || '');
      this.postalCode.set(doc.address?.postalCode || '');
      this.logoUrl.set(doc.logoUrl || null);
      this.isDirty.set(false);
      this.errors.set({});
    }
  }

  async onLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      this.toast.error('Image must be smaller than 2MB');
      return;
    }

    const customerId = this.portal.linkedCustomerId();
    if (!customerId) return;

    this.isUploadingLogo.set(true);
    try {
      const path = `customers/${customerId}/logo_${Date.now()}`;
      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      this.logoUrl.set(url);
      this.isDirty.set(true);
      this.toast.success('Logo uploaded');
    } catch (err) {
      console.error('Logo upload error:', err);
      this.toast.error('Failed to upload logo');
    } finally {
      this.isUploadingLogo.set(false);
      // Reset input
      input.value = '';
    }
  }

  removeLogo() {
    this.logoUrl.set(null);
    this.isDirty.set(true);
  }


  getInitial(): string {
    return (
      this.businessName() ||
      this.portal.businessName() ||
      '?'
    ).charAt(0).toUpperCase();
  }
}
