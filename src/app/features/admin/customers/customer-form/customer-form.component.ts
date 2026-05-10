import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { Customer } from '../../../../core/models/customer.model';
import { where, serverTimestamp } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';

interface ServiceArea {
  id: string;
  name: string;
  active?: boolean;
  isDeleted?: boolean;
}

@Component({
  selector: 'app-customer-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LoadingSpinnerComponent, StatusBadgeComponent],
  templateUrl: './customer-form.component.html',
  styleUrl: './customer-form.component.scss'
})
export class CustomerFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly storage = inject(Storage);

  isEditMode = signal(false);
  isLoading = signal(false);
  isSaving = signal(false);
  customerId = signal<string | null>(null);
  customer = signal<Customer | null>(null);
  
  logoFile = signal<File | null>(null);
  logoPreviewUrl = signal<string | null>(null);

  serviceAreas = signal<ServiceArea[]>([]);

  businessTypes = [
    'Convenience Store',
    'Gas Station',
    'Grocery Store',
    'Corner Store',
    'Pharmacy',
    'Restaurant / Café',
    'Online Retailer',
    'Wholesale Buyer',
    'Other'
  ];

  provinces = [
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
    { code: 'YT', name: 'Yukon' }
  ];

  form: FormGroup = this.fb.group({
    businessName: ['', [Validators.required]],
    businessType: ['', [Validators.required]],
    businessTypeCustom: [''],
    ownerName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, Validators.minLength(10)]],
    address: this.fb.group({
      street: ['', [Validators.required]],
      city: ['', [Validators.required]],
      province: ['', [Validators.required]],
      postalCode: ['', [Validators.required, Validators.pattern(/^[a-zA-Z]\d[a-zA-Z] ?\d[a-zA-Z]\d$/)]],
      country: [{ value: 'Canada', disabled: true }]
    }),
    serviceAreaSelection: [''],
    serviceAreaCustom: [''],
    status: ['active', [Validators.required]],
    notes: ['']
  });

  ngOnInit() {
    this.loadServiceAreas();
    
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode.set(true);
      this.customerId.set(id);
      this.loadCustomer(id);
    }
  }

  private loadServiceAreas() {
    this.firestore.getCollection<ServiceArea>(
      'serviceAreas',
      where('tenantId', '==', 1)
    ).subscribe({
      next: (allAreas) => {
        const active = allAreas.filter(a => a.active === true && a.isDeleted !== true);
        this.serviceAreas.set(active);
      },
      error: (err) => console.error('Failed to load service areas', err)
    });
  }

  private loadCustomer(id: string) {
    this.isLoading.set(true);
    this.firestore.getDocument<Customer>(`customers/${id}`).subscribe({
      next: (data) => {
        if (!data || data.isDeleted) {
          this.toast.error('Customer not found');
          this.router.navigate(['/admin/customers']);
          return;
        }
        
        this.customer.set(data);
        
        let saSelection = '';
        if (data.serviceAreaCustom) {
          saSelection = 'other';
        } else if (data.serviceAreaId) {
          saSelection = data.serviceAreaId;
        }

        this.form.patchValue({
          businessName: data.businessName,
          businessType: data.businessType || '',
          businessTypeCustom: data.businessTypeCustom || '',
          ownerName: data.ownerName,
          email: data.email,
          phone: data.phone,
          address: {
            street: data.address.street,
            city: data.address.city,
            province: data.address.province,
            postalCode: data.address.postalCode,
            country: 'Canada'
          },
          serviceAreaSelection: saSelection,
          serviceAreaCustom: data.serviceAreaCustom || '',
          status: data.status,
          notes: data.notes || ''
        });

        if (data.logoUrl) {
          this.logoPreviewUrl.set(data.logoUrl);
        }

        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load customer', err);
        this.toast.error('Failed to load customer details');
        this.router.navigate(['/admin/customers']);
      }
    });
  }

  isInvalid(path: string): boolean {
    const control = this.form.get(path);
    return !!(control && control.invalid && (control.dirty || control.touched));
  }

  showCustomArea(): boolean {
    return this.form.get('serviceAreaSelection')?.value === 'other';
  }

  showCustomBusinessType(): boolean {
    return this.form.get('businessType')?.value === 'Other';
  }

  onLogoSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        this.toast.error('Only JPG and PNG files are allowed');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.toast.error('File size must be less than 2MB');
        return;
      }

      this.logoFile.set(file);

      const reader = new FileReader();
      reader.onload = (e) => this.logoPreviewUrl.set(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  }

  removeLogo() {
    this.logoFile.set(null);
    const cust = this.customer();
    if (cust && cust.logoUrl) {
      this.logoPreviewUrl.set(cust.logoUrl);
    } else {
      this.logoPreviewUrl.set(null);
    }
  }

  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      
      const firstInvalidControl = document.querySelector('.ng-invalid');
      if (firstInvalidControl) {
        firstInvalidControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      this.toast.error('Please fix the errors in the form');
      return;
    }

    this.isSaving.set(true);

    try {
      const val = this.form.getRawValue();
      const actionBy = this.auth.getActionBy();
      
      if (val.businessType === 'Other' && !val.businessTypeCustom?.trim()) {
        this.toast.error('Please specify your business type');
        this.isSaving.set(false);
        return;
      }

      let serviceAreaId = null;
      let serviceAreaCustom = null;

      if (val.serviceAreaSelection === 'other') {
        serviceAreaCustom = val.serviceAreaCustom;
      } else if (val.serviceAreaSelection) {
        serviceAreaId = val.serviceAreaSelection;
      }

      let finalLogoUrl = this.customer()?.logoUrl || null;

      if (this.isEditMode() && this.customerId()) {
        const docId = this.customerId()!;
        
        if (this.logoFile()) {
          const ext = this.logoFile()!.name.split('.').pop();
          const storageRef = ref(this.storage, `customers/${docId}/logo.${ext}`);
          await uploadBytes(storageRef, this.logoFile()!);
          finalLogoUrl = await getDownloadURL(storageRef);
        }

        await this.firestore.updateDocument(`customers/${docId}`, {
          businessName: val.businessName,
          businessType: val.businessType,
          businessTypeCustom: val.businessType === 'Other' ? val.businessTypeCustom : null,
          logoUrl: finalLogoUrl,
          ownerName: val.ownerName,
          email: val.email,
          phone: val.phone,
          address: {
            street: val.address.street,
            city: val.address.city,
            province: val.address.province,
            postalCode: val.address.postalCode,
            country: 'Canada'
          },
          serviceAreaId,
          serviceAreaCustom,
          status: val.status,
          notes: val.notes,
          updatedAt: serverTimestamp(),
        });
        
        this.toast.success('Customer updated successfully');
        this.router.navigate(['/admin/customers', docId]);
      } else {
        // Prepare initial document without logo
        const docRef = await this.firestore.addDocument('customers', {
          businessName: val.businessName,
          businessType: val.businessType,
          businessTypeCustom: val.businessType === 'Other' ? val.businessTypeCustom : null,
          ownerName: val.ownerName,
          email: val.email,
          phone: val.phone,
          address: {
            street: val.address.street,
            city: val.address.city,
            province: val.address.province,
            postalCode: val.address.postalCode,
            country: 'Canada'
          },
          serviceAreaId,
          serviceAreaCustom,
          status: val.status,
          notes: val.notes,
          source: 'admin_created',
          tenantId: 1,
          isDeleted: false,
          totalOrderedCents: 0,
          totalPaidCents: 0,
          totalOwingCents: 0,
          currencyCode: 'CAD',
          createdAt: serverTimestamp(),
          createdBy: actionBy
        });
        
        // Upload logo if selected
        if (this.logoFile()) {
          const ext = this.logoFile()!.name.split('.').pop();
          const storageRef = ref(this.storage, `customers/${docRef.id}/logo.${ext}`);
          await uploadBytes(storageRef, this.logoFile()!);
          finalLogoUrl = await getDownloadURL(storageRef);
          
          await this.firestore.updateDocument(`customers/${docRef.id}`, {
            logoUrl: finalLogoUrl
          });
        }
        
        this.toast.success('Customer added successfully');
        this.router.navigate(['/admin/customers', docRef.id]);
      }
    } catch (e) {
      console.error('Error saving customer', e);
      this.toast.error('Failed to save customer');
      this.isSaving.set(false);
    }
  }

  async deleteCustomer() {
    const cust = this.customer();
    if (!cust) return;
    
    if (!confirm(`Are you sure you want to delete ${cust.businessName}?`)) {
      return;
    }

    try {
      await this.firestore.updateDocument(`customers/${cust.id}`, {
        isDeleted: true,
        isDeletedAt: serverTimestamp(),
        deletedBy: this.auth.getActionBy()
      });
      this.toast.success('Customer deleted successfully');
      this.router.navigate(['/admin/customers']);
    } catch (e) {
      console.error('Delete failed', e);
      this.toast.error('Failed to delete customer');
    }
  }

  formatCurrency(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
