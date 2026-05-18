import { Component, inject, signal, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ToastService } from '../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { ContentService, ContentData } from '../../../core/services/content.service';

@Component({
  selector: 'app-admin-content',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './admin-content.component.html',
  styleUrl: './admin-content.component.scss',
})
export class AdminContentComponent {
  protected readonly content = inject(ContentService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  // Edit state per section
  editingHero = signal(false);
  editingAbout = signal(false);
  editingContact = signal(false);
  editingWhyUs = signal(false);
  editingFooter = signal(false);
  editingWhatWeSupply = signal(false);
  isSaving = signal(false);

  // Hero fields
  heroHeadline = signal('');
  heroSubheadline = signal('');
  heroCtaText = signal('');
  heroBadgeText = signal('');

  // About fields
  aboutText = signal('');

  // What We Supply
  whatWeSupply = signal<string[]>([]);
  newSupplyItem = signal('');

  // Contact fields
  contactPhone = signal('');
  contactEmail = signal('');
  contactAddress = signal('');
  contactHours = signal('');

  // Why Partner Points
  whyPartnerPoints = signal<{ heading: string; body: string }[]>([]);

  // Footer fields
  footerText = signal('');
  footerTagline = signal('');

  constructor() {
    effect(() => {
      const c = this.content.content();
      this.heroHeadline.set(c.heroHeadline || '');
      this.heroSubheadline.set(c.heroSubheadline || '');
      this.heroCtaText.set(c.heroCtaText || '');
      this.heroBadgeText.set(c.heroBadgeText || '');
      this.aboutText.set(c.aboutText || '');
      this.contactPhone.set(c.publicContactInfo?.phone || '');
      this.contactEmail.set(c.publicContactInfo?.email || '');
      this.contactAddress.set(c.publicContactInfo?.address || '');
      this.contactHours.set(c.publicContactInfo?.hours || '');
      this.whyPartnerPoints.set(
        c.whyPartnerPoints?.map(p => ({ ...p })) || []
      );
      this.footerText.set(c.footerText || '');
      this.footerTagline.set(c.footerTagline || '');
      this.whatWeSupply.set([...(c.whatWeSupply || [])]);
    }, { allowSignalWrites: true });
  }

  // Cancel methods reset to saved values
  cancelHero() {
    const c = this.content.content();
    this.heroHeadline.set(c.heroHeadline);
    this.heroSubheadline.set(c.heroSubheadline);
    this.heroCtaText.set(c.heroCtaText);
    this.heroBadgeText.set(c.heroBadgeText);
    this.editingHero.set(false);
  }

  cancelAbout() {
    this.aboutText.set(this.content.content().aboutText);
    this.editingAbout.set(false);
  }

  cancelContact() {
    const c = this.content.content();
    this.contactPhone.set(c.publicContactInfo?.phone || '');
    this.contactEmail.set(c.publicContactInfo?.email || '');
    this.contactAddress.set(c.publicContactInfo?.address || '');
    this.contactHours.set(c.publicContactInfo?.hours || '');
    this.editingContact.set(false);
  }

  cancelWhyUs() {
    const c = this.content.content();
    this.whyPartnerPoints.set(
      c.whyPartnerPoints?.map(p => ({ ...p })) || []
    );
    this.editingWhyUs.set(false);
  }

  cancelFooter() {
    const c = this.content.content();
    this.footerText.set(c.footerText);
    this.footerTagline.set(c.footerTagline);
    this.editingFooter.set(false);
  }

  // Save methods — only save the changed section,
  // merge with existing content
  private async saveContent(partial: Partial<ContentData>) {
    await this.firestore.setDocument('settings/content', {
      ...this.content.content(),
      ...partial,
    });
  }

  async saveHero() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        heroHeadline: this.heroHeadline(),
        heroSubheadline: this.heroSubheadline(),
        heroCtaText: this.heroCtaText(),
        heroBadgeText: this.heroBadgeText(),
      });
      this.toast.success('Hero section saved');
      this.editingHero.set(false);
    } catch (err) {
      this.toast.error('Failed to save hero section');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveAbout() {
    this.isSaving.set(true);
    try {
      await this.saveContent({ aboutText: this.aboutText() });
      this.toast.success('About section saved');
      this.editingAbout.set(false);
    } catch (err) {
      this.toast.error('Failed to save about section');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveContact() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        publicContactInfo: {
          phone: this.contactPhone(),
          email: this.contactEmail(),
          address: this.contactAddress(),
          hours: this.contactHours(),
        }
      });
      this.toast.success('Contact info saved');
      this.editingContact.set(false);
    } catch (err) {
      this.toast.error('Failed to save contact info');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveWhyUs() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        whyPartnerPoints: this.whyPartnerPoints()
      });
      this.toast.success('"Why Partner" section saved');
      this.editingWhyUs.set(false);
    } catch (err) {
      this.toast.error('Failed to save section');
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveFooter() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        footerText: this.footerText(),
        footerTagline: this.footerTagline(),
      });
      this.toast.success('Footer saved');
      this.editingFooter.set(false);
    } catch (err) {
      this.toast.error('Failed to save footer');
    } finally {
      this.isSaving.set(false);
    }
  }

  // Why Partner Points management
  addPoint() {
    this.whyPartnerPoints.update(pts => [
      ...pts,
      { heading: '', body: '' }
    ]);
  }

  removePoint(index: number) {
    this.whyPartnerPoints.update(pts =>
      pts.filter((_, i) => i !== index)
    );
  }

  updatePointHeading(index: number, value: string) {
    this.whyPartnerPoints.update(pts =>
      pts.map((p, i) => i === index
        ? { ...p, heading: value } : p
      )
    );
  }

  updatePointBody(index: number, value: string) {
    this.whyPartnerPoints.update(pts =>
      pts.map((p, i) => i === index
        ? { ...p, body: value } : p
      )
    );
  }

  cancelWhatWeSupply() {
    this.whatWeSupply.set(
      [...(this.content.content().whatWeSupply || [])]
    );
    this.newSupplyItem.set('');
    this.editingWhatWeSupply.set(false);
  }

  async saveWhatWeSupply() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        whatWeSupply: this.whatWeSupply()
      });
      this.toast.success('"What We Supply" saved');
      this.editingWhatWeSupply.set(false);
      this.newSupplyItem.set('');
    } catch (err) {
      this.toast.error('Failed to save');
    } finally {
      this.isSaving.set(false);
    }
  }

  addSupplyItem() {
    const item = this.newSupplyItem().trim();
    if (!item) return;
    this.whatWeSupply.update(list => [...list, item]);
    this.newSupplyItem.set('');
  }

  removeSupplyItem(index: number) {
    this.whatWeSupply.update(list =>
      list.filter((_, i) => i !== index)
    );
  }
}


