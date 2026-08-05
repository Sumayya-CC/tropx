import { Component, effect, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';

@Component({
  selector: 'app-business-info-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './business-info-card.component.html',
  styleUrl: './business-info-card.component.scss',
})
export class BusinessInfoCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingBusiness = signal(false);
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

  constructor() {
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
}
