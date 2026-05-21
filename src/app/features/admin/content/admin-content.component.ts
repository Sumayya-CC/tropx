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

  // Why Partner Points
  whyPartnerPoints = signal<{ heading: string; body: string }[]>([]);

  // Footer fields
  footerText = signal('');
  footerTagline = signal('');

  // Why Us
  whyUsSectionLabel = signal('');
  whyUsSectionTitle = signal('');
  whyUsSectionSubtext = signal('');
  editingWhyUsSection = signal(false);

  // How It Works
  stepColors = [
    { value: 'navy' as const, label: 'Navy', hex: 'var(--navy-deep)' },
    { value: 'blue' as const, label: 'Blue', hex: 'var(--navy)' },
    { value: 'red' as const, label: 'Red', hex: 'var(--red)' },
    { value: 'green' as const, label: 'Green', hex: 'var(--green)' },
    { value: 'gold' as const, label: 'Gold', hex: 'var(--gold)' },
    { value: 'purple' as const, label: 'Purple', hex: '#7c3aed' },
  ];
  howItWorksSectionLabel = signal('');
  howItWorksSectionTitle = signal('');
  howItWorksSteps = signal<{
    title: string;
    description: string;
    color: 'navy' | 'red' | 'green' | 'gold' | 'blue' | 'purple';
  }[]>([]);
  howItWorksCtaText = signal('');
  editingHowItWorks = signal(false);

  // About headings
  aboutSectionLabel = signal('');
  aboutSectionTitle = signal('');
  aboutTrustBadges = signal<string[]>([]);
  aboutWhatWeSupplyLabel = signal('');
  newTrustBadge = signal('');
  editingAboutSection = signal(false);

  // Contact headings
  contactSectionLabel = signal('');
  contactSectionTitle = signal('');
  contactPartnerNote = signal('');
  editingContactSection = signal(false);

  constructor() {
    effect(() => {
      const c = this.content.content();
      this.heroHeadline.set(c.heroHeadline || '');
      this.heroSubheadline.set(c.heroSubheadline || '');
      this.heroCtaText.set(c.heroCtaText || '');
      this.heroBadgeText.set(c.heroBadgeText || '');
      this.aboutText.set(c.aboutText || '');
      this.whyPartnerPoints.set(
        c.whyPartnerPoints?.map(p => ({ ...p })) || []
      );
      this.footerText.set(c.footerText || '');
      this.footerTagline.set(c.footerTagline || '');
      this.whatWeSupply.set([...(c.whatWeSupply || [])]);
      this.whyUsSectionLabel.set(c.whyUsSectionLabel || '');
      this.whyUsSectionTitle.set(c.whyUsSectionTitle || '');
      this.whyUsSectionSubtext.set(c.whyUsSectionSubtext || '');
      this.howItWorksSectionLabel.set(c.howItWorksSectionLabel || '');
      this.howItWorksSectionTitle.set(c.howItWorksSectionTitle || '');
      this.howItWorksSteps.set(
        c.howItWorksSteps?.map(s => ({ ...s })) || []
      );
      this.howItWorksCtaText.set(c.howItWorksCtaText || '');
      this.aboutSectionLabel.set(c.aboutSectionLabel || '');
      this.aboutSectionTitle.set(c.aboutSectionTitle || '');
      this.aboutTrustBadges.set([...(c.aboutTrustBadges || [])]);
      this.aboutWhatWeSupplyLabel.set(c.aboutWhatWeSupplyLabel || '');
      this.contactSectionLabel.set(c.contactSectionLabel || '');
      this.contactSectionTitle.set(c.contactSectionTitle || '');
      this.contactPartnerNote.set(c.contactPartnerNote || '');
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

  async saveWhyUsSection() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        whyUsSectionLabel: this.whyUsSectionLabel(),
        whyUsSectionTitle: this.whyUsSectionTitle(),
        whyUsSectionSubtext: this.whyUsSectionSubtext(),
      });
      this.toast.success('Why Us section saved');
      this.editingWhyUsSection.set(false);
    } catch { this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelWhyUsSection() {
    const c = this.content.content();
    this.whyUsSectionLabel.set(c.whyUsSectionLabel || '');
    this.whyUsSectionTitle.set(c.whyUsSectionTitle || '');
    this.whyUsSectionSubtext.set(c.whyUsSectionSubtext || '');
    this.editingWhyUsSection.set(false);
  }

  async saveHowItWorks() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        howItWorksSectionLabel: this.howItWorksSectionLabel(),
        howItWorksSectionTitle: this.howItWorksSectionTitle(),
        howItWorksSteps: this.howItWorksSteps(),
        howItWorksCtaText: this.howItWorksCtaText(),
      });
      this.toast.success('How It Works section saved');
      this.editingHowItWorks.set(false);
    } catch { this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelHowItWorks() {
    const c = this.content.content();
    this.howItWorksSectionLabel.set(
      c.howItWorksSectionLabel || ''
    );
    this.howItWorksSectionTitle.set(
      c.howItWorksSectionTitle || ''
    );
    this.howItWorksSteps.set(
      c.howItWorksSteps?.map(s => ({ ...s })) || []
    );
    this.howItWorksCtaText.set(c.howItWorksCtaText || '');
    this.editingHowItWorks.set(false);
  }

  // How It Works steps management
  addStep() {
    this.howItWorksSteps.update(steps => [
      ...steps,
      { title: '', description: '', color: 'navy' as const }
    ]);
  }

  removeStep(index: number) {
    this.howItWorksSteps.update(steps =>
      steps.filter((_, i) => i !== index)
    );
  }

  updateStepTitle(index: number, value: string) {
    this.howItWorksSteps.update(steps =>
      steps.map((s, i) => i === index 
        ? { ...s, title: value } : s)
    );
  }

  updateStepDescription(index: number, value: string) {
    this.howItWorksSteps.update(steps =>
      steps.map((s, i) => i === index 
        ? { ...s, description: value } : s)
    );
  }

  updateStepColor(index: number, 
    value: 'navy' | 'red' | 'green' | 'gold' | 'blue' | 'purple') {
    this.howItWorksSteps.update(steps =>
      steps.map((s, i) => i === index 
        ? { ...s, color: value } : s)
    );
  }

  async saveAboutSection() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        aboutSectionLabel: this.aboutSectionLabel(),
        aboutSectionTitle: this.aboutSectionTitle(),
        aboutTrustBadges: this.aboutTrustBadges(),
        aboutWhatWeSupplyLabel: this.aboutWhatWeSupplyLabel(),
      });
      this.toast.success('About section headings saved');
      this.editingAboutSection.set(false);
    } catch { this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelAboutSection() {
    const c = this.content.content();
    this.aboutSectionLabel.set(c.aboutSectionLabel || '');
    this.aboutSectionTitle.set(c.aboutSectionTitle || '');
    this.aboutTrustBadges.set([...(c.aboutTrustBadges || [])]);
    this.aboutWhatWeSupplyLabel.set(
      c.aboutWhatWeSupplyLabel || ''
    );
    this.newTrustBadge.set('');
    this.editingAboutSection.set(false);
  }

  addTrustBadge() {
    const item = this.newTrustBadge().trim();
    if (!item) return;
    this.aboutTrustBadges.update(list => [...list, item]);
    this.newTrustBadge.set('');
  }

  removeTrustBadge(index: number) {
    this.aboutTrustBadges.update(list =>
      list.filter((_, i) => i !== index)
    );
  }

  async saveContactSection() {
    this.isSaving.set(true);
    try {
      await this.saveContent({
        contactSectionLabel: this.contactSectionLabel(),
        contactSectionTitle: this.contactSectionTitle(),
        contactPartnerNote: this.contactPartnerNote(),
      });
      this.toast.success('Contact section saved');
      this.editingContactSection.set(false);
    } catch { this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelContactSection() {
    const c = this.content.content();
    this.contactSectionLabel.set(c.contactSectionLabel || '');
    this.contactSectionTitle.set(c.contactSectionTitle || '');
    this.contactPartnerNote.set(c.contactPartnerNote || '');
    this.editingContactSection.set(false);
  }
}


