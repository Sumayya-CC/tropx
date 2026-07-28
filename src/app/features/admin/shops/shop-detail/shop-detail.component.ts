import { Component, inject, signal, effect, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { Shop } from '../../../../core/models/shop.model';
import { Customer } from '../../../../core/models/customer.model';
import { serverTimestamp } from '@angular/fire/firestore';
import { OwnerFullNamePipe } from '../../../../shared/pipes/full-name.pipe';
import { ShopLinkService } from '../../../../core/services/shop-link.service';
import { EntityLinkModalComponent, LinkableItem } from '../../../../shared/components/entity-link-modal/entity-link-modal.component';
import { LogVisitComponent } from '../log-visit/log-visit.component';
import { VisitService } from '../../../../core/services/visit.service';
import { Visit } from '../../../../core/models/shop.model';
import { Product } from '../../../../core/models/product.model';
import { where } from '@angular/fire/firestore';
import { CommonModule, DatePipe } from '@angular/common';
import { HEALTH_BAND_LABELS, HEALTH_BAND_TONE, HealthBand } from '../../../../shared/utils/shop-health.utils';
import { FormsModule } from '@angular/forms';
import { PipelineService } from '../../../../core/services/pipeline.service';
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS, isForward, stageIndex } from '../../../../shared/utils/pipeline.utils';
import { PipelineStage } from '../../../../core/models/shop.model';
import { toDateInputValue, dateInputToLocalDate } from '../../../../shared/utils/date.utils';
import { SettingsService } from '../../../../core/services/settings.service';
import { ExpenseFormModalComponent } from '../../expenses/expense-form-modal/expense-form-modal.component';

@Component({
  selector: 'app-shop-detail',
  standalone: true,
  imports: [RouterLink, LoadingSpinnerComponent, OwnerFullNamePipe, EntityLinkModalComponent, LogVisitComponent, CommonModule, FormsModule, ExpenseFormModalComponent],
  templateUrl: './shop-detail.component.html',
  styleUrl: './shop-detail.component.scss'
})
export class ShopDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly shopLink = inject(ShopLinkService);
  private readonly visits = inject(VisitService);
  private readonly pipeline = inject(PipelineService);
  protected readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  shop = signal<Shop | null>(null);
  linkedCustomer = signal<Customer | null>(null);
  isLoading = signal(true);
  
  showLinkModal = signal(false);
  linkItems = signal<LinkableItem[]>([]);
  linkSuggestedIds = signal<string[]>([]);
  linkBusy = signal(false);

  showLogVisit = signal(false);
  editingVisit = signal<Visit | null>(null);
  showDeleteVisit = signal<Visit | null>(null);
  reverseStockOnDelete = signal(false);

  visitHistory = signal<Visit[]>([]);
  expandedVisitId = signal<string | null>(null);
  showConvertPrompt = signal(false);
  products = signal<Product[]>([]);
  pendingConversion = computed(() => {
    const s = this.shop();
    if (!s || s.linkedCustomerId) return null;
    return this.visitHistory().find(v => v.markedConversion) ?? null;
  });

  readonly pipelineStages = PIPELINE_STAGES;
  readonly pipelineStageLabels = PIPELINE_STAGE_LABELS;
  showNextAction = signal(false);
  naDate = signal<string>('');
  naNote = signal('');
  showAdvancePrompt = signal(false);
  advanceToStage = signal<PipelineStage | null>(null);

  showFuelPopup = signal(false);
  pendingFuelVisitId = signal<string | null>(null);

  isProspect(): boolean { return this.shop()?.status === 'prospect'; }

  async changeStage(newStage: string) {
    const s = this.shop();
    if (!s || s.pipelineStage === newStage) return;
    try {
      await this.pipeline.changeStage(s, newStage as PipelineStage);
      this.toast.success(`Stage → ${this.pipelineStageLabels[newStage as PipelineStage]}`);
      this.loadShop(s.id);
    } catch (e) { console.error(e); this.toast.error('Failed to change stage'); }
  }

  async toggleNavCoords() {
    const s = this.shop(); if (!s) return;
    const next = !s.preferCoordinatesForNav;
    try {
      const writes: Promise<any>[] = [this.firestore.updateDocument(`shops/${s.id}`, { preferCoordinatesForNav: next })];
      if (s.linkedCustomerId) writes.push(this.firestore.updateDocument(`customers/${s.linkedCustomerId}`, { preferCoordinatesForNav: next }));
      await Promise.all(writes);
      this.toast.success(next ? 'Navigation will use exact coordinates' : 'Navigation will use address');
      this.loadShop(s.id);
    } catch (e) { console.error(e); this.toast.error('Failed to update'); }
  }

  openNextAction() {
    const s = this.shop();
    const v: any = s?.nextActionDate;
    if (v) {
      const d = v?.toDate ? v.toDate() : new Date(v);
      this.naDate.set(toDateInputValue(d));
    } else { this.naDate.set(''); }
    this.naNote.set(s?.nextActionNote || '');
    this.showNextAction.set(true);
  }
  async saveNextAction() {
    const s = this.shop();
    if (!s) return;
    const date = this.naDate() ? dateInputToLocalDate(this.naDate()) : null;
    try {
      await this.pipeline.setNextAction(s.id, date, this.naNote());
      this.toast.success('Next action saved');
      this.showNextAction.set(false);
      this.loadShop(s.id);
    } catch (e) { console.error(e); this.toast.error('Failed'); }
  }
  async clearNextAction() {
    const s = this.shop();
    if (!s) return;
    await this.pipeline.clearNextAction(s.id);
    this.showNextAction.set(false);
    this.loadShop(s.id);
  }

  historyEntries(): { stage: string; date: Date; label: string }[] {
    const s = this.shop();
    return (s?.pipelineHistory || []).map(h => {
      const v: any = h.enteredAt;
      const d = v?.toDate ? v.toDate() : new Date(v);
      return { stage: h.stage, date: d, label: this.pipelineStageLabels[h.stage as PipelineStage] };
    });
  }

  canRestock = computed(() => {
    const s = this.shop();
    if (!s?.linkedCustomerId) return false;
    const last = this.visitHistory()[0];
    if (!last) return false;
    if (last.restockOrderId) return false;   // already ordered from this visit
    return last.items.some(it => it.productId && (it.added ?? 0) > 0);
  });

  linkedCustomerName = computed(() => this.linkedCustomer()?.businessName ?? null);

  constructor() {
    this.firestore.getCollection<Product>('products', where('active', '==', true))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(p => this.products.set(p));
      
    effect(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id) this.loadShop(id);
    });
  }

  private loadShop(id: string) {
    this.firestore.getDocument<Shop>(`shops/${id}`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        if (!data || data.isDeleted) {
          this.toast.error('Shop not found'); this.router.navigate(['/admin/shops']); return;
        }
        this.shop.set(data);
        this.isLoading.set(false);
        this.loadVisits(data.id);
        if (data.linkedCustomerId) this.loadLinkedCustomer(data.linkedCustomerId);
      },
      error: (err) => {
        console.error('Failed to load shop', err);
        this.toast.error('Failed to load shop'); this.router.navigate(['/admin/shops']);
      }
    });
  }

  private loadLinkedCustomer(customerId: string) {
    this.firestore.getDocument<Customer>(`customers/${customerId}`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (c) => this.linkedCustomer.set(c && !c.isDeleted ? c : null),
      error: () => this.linkedCustomer.set(null)
    });
  }

  statusLabel(): string {
    const s = this.shop()?.status;
    return s ? ({ prospect: 'Prospect', customer: 'Customer', not_interested: 'Not Interested', dormant: 'Dormant' } as any)[s] ?? s : '';
  }

  pipelineLabel(): string {
    const p = this.shop()?.pipelineStage;
    if (!p) return '';
    return ({
      first_contact: 'First Contact', manager_meeting: 'Manager Meeting',
      sample_left: 'Sample Left', decision: 'Decision', opened: 'Opened',
    } as any)[p] ?? p;
  }

  shopHealth(): { label: string; tone: string; days: number | null; kind: string; known: boolean } | null {
    const s = this.shop();
    if (!s) return null;
    const band = (s.healthBand || 'unknown') as HealthBand;
    return {
      label: HEALTH_BAND_LABELS[band],
      tone: HEALTH_BAND_TONE[band],
      days: s.healthDays ?? null,
      kind: s.healthKind || (s.linkedCustomerId ? 'customer' : 'prospect'),
      known: band !== 'unknown',
    };
  }

  getInitials(name: string): string {
    return name ? name.substring(0, 2).toUpperCase() : '??';
  }

  managerName(): string {
    const s = this.shop();
    return s ? [s.managerFirstName, s.managerLastName].filter(Boolean).join(' ') : '';
  }

  makeCustomer() {
    const s = this.shop();
    if (!s) return;
    if (s.linkedCustomerId) { this.router.navigate(['/admin/customers', s.linkedCustomerId]); return; }
    this.openPicker(s);
  }

  private async openPicker(s: Shop) {
    this.linkBusy.set(true);
    try {
      const [suggestions, browse] = await Promise.all([
        this.shopLink.findCustomerSuggestionsForShop(s),
        this.shopLink.listCustomersWithoutShop(),
      ]);
      const suggestedIds = suggestions.map(c => c.id);
      const merged = [...suggestions, ...browse].filter(
        (c, i, arr) => arr.findIndex(x => x.id === c.id) === i
      );
      this.linkItems.set(merged.map(c => ({
        id: c.id,
        primaryText: c.businessName,
        secondaryText: [c.address?.city, c.phone].filter(Boolean).join(' · '),
      })));
      this.linkSuggestedIds.set(suggestedIds);
      this.showLinkModal.set(true);
    } catch (e) {
      console.error('Failed to load customers for linking', e);
      this.toast.error('Could not load customers');
    } finally {
      this.linkBusy.set(false);
    }
  }

  async onLinkCustomer(customerId: string) {
    const s = this.shop();
    if (!s) return;
    this.linkBusy.set(true);
    try {
      await this.shopLink.linkCustomerAndShop(customerId, s.id);
      this.toast.success('Shop linked to customer');
      this.closeLinkModal();
      this.loadShop(s.id);
    } catch (e) {
      console.error('Link failed', e);
      this.toast.error('Failed to link');
    } finally {
      this.linkBusy.set(false);
    }
  }

  closeLinkModal() {
    this.showLinkModal.set(false);
    this.maybeShowFuelPopup();
  }

  onAddNewCustomer() {
    const s = this.shop();
    if (!s) return;
    this.router.navigate(['/admin/customers/add'], { queryParams: { fromShop: s.id } });
  }

  async deleteShop() {
    const s = this.shop();
    if (!s) return;
    if (!confirm(`Delete ${s.name}? A linked customer, if any, is not deleted.`)) return;
    try {
      await this.firestore.updateDocument(`shops/${s.id}`, {
        isDeleted: true, isDeletedAt: serverTimestamp(), deletedBy: this.auth.getActionBy()
      });
      this.toast.success('Shop deleted');
      this.router.navigate(['/admin/shops']);
    } catch (e) {
      console.error('Delete failed', e);
      this.toast.error('Failed to delete shop');
    }
  }

  showUnlinkDialog = signal(false);
  unlinkNewStatus = signal<'prospect' | 'dormant' | 'not_interested'>('prospect');
  unlinkBusy = signal(false);

  openUnlink() {
    this.unlinkNewStatus.set('prospect');
    this.showUnlinkDialog.set(true);
  }

  async confirmUnlink() {
    const s = this.shop();
    const custId = s?.linkedCustomerId;
    if (!s || !custId) return;
    this.unlinkBusy.set(true);
    try {
      await this.shopLink.unlinkCustomerAndShop(custId, s.id, this.unlinkNewStatus());
      this.toast.success('Unlinked. Shop status updated.');
      this.showUnlinkDialog.set(false);
      this.linkedCustomer.set(null);
      this.loadShop(s.id); // reload to reflect new status + cleared link
    } catch (e) {
      console.error('Unlink failed', e);
      this.toast.error('Failed to unlink');
    } finally {
      this.unlinkBusy.set(false);
    }
  }

  openLogVisit() { this.editingVisit.set(null); this.showLogVisit.set(true); }
  openEditVisit(v: Visit) { this.editingVisit.set(v); this.showLogVisit.set(true); }

  askDeleteVisit(v: Visit) {
    this.reverseStockOnDelete.set(false);
    this.showDeleteVisit.set(v);
  }
  
  visitHasSamples(v: Visit): boolean {
    return v.items.some(it => it.isSample && it.productId && (it.sampleQty ?? 0) > 0);
  }
  
  async confirmDeleteVisit() {
    const v = this.showDeleteVisit();
    const s = this.shop();
    const actionBy = this.auth.getActionBy();
    if (!v || !s || !actionBy) {
      if (!actionBy) this.toast.error('You must be logged in to delete a visit.');
      return;
    }
    try {
      await this.visits.deleteVisit(v, this.reverseStockOnDelete(), actionBy);
      this.toast.success('Visit deleted');
      this.showDeleteVisit.set(null);
      await this.loadVisits(s.id);
    } catch (e) {
      console.error('Delete visit failed', e);
      this.toast.error('Failed to delete visit');
    }
  }
  
  async onVisitSaved(payload: { id: string; outcome: string | null; markedConversion: boolean }) {
    this.showLogVisit.set(false);
    this.editingVisit.set(null);
    const s = this.shop();
    if (s) await this.loadVisits(s.id);
    const shop = this.shop();
    this.pendingFuelVisitId.set(payload.id);
    if (!shop) return;

    // Path A: conversion intent → auto-advance to 'opened' (forward only), then existing convert prompt.
    if (payload.markedConversion && shop.status === 'prospect') {
      if (shop.pipelineStage !== 'opened' && isForward(shop.pipelineStage || 'first_contact', 'opened')) {
        try { await this.pipeline.changeStage(shop, 'opened'); await this.loadShop(shop.id); } catch (e) { console.error(e); }
      }
      // existing Phase-2 convert prompt (pendingConversion) fires as before — do NOT add another modal
      if (this.pendingConversion() && !shop.linkedCustomerId) {
        this.showConvertPrompt.set(true);
      } else {
        this.maybeShowFuelPopup();
      }
      return; // Path A owns this; never fall through to Path B
    }

    // Path B: sample_left outcome on an earlier-stage prospect → single advance prompt.
    if (shop.status === 'prospect' && payload.outcome === 'sample_left'
        && isForward(shop.pipelineStage || 'first_contact', 'sample_left')) {
      this.advanceToStage.set('sample_left');
      this.showAdvancePrompt.set(true);
      return;
    }

    // Otherwise nothing pipeline-related.
    if (this.pendingConversion() && !shop.linkedCustomerId) {
      this.showConvertPrompt.set(true);
    } else {
      this.maybeShowFuelPopup();
    }
  }

  async confirmAdvance() {
    const shop = this.shop(); const stage = this.advanceToStage();
    if (!shop || !stage) { this.showAdvancePrompt.set(false); return; }
    try { await this.pipeline.changeStage(shop, stage); await this.loadShop(shop.id);
      this.toast.success(`Advanced to ${this.pipelineStageLabels[stage]}`); }
    catch (e) { console.error(e); this.toast.error('Failed to advance'); }
    finally { this.showAdvancePrompt.set(false); this.advanceToStage.set(null); this.maybeShowFuelPopup(); }
  }

  dismissAdvancePrompt() {
    this.showAdvancePrompt.set(false);
    this.advanceToStage.set(null);
    this.maybeShowFuelPopup();
  }

  dismissConvertPrompt() {
    this.showConvertPrompt.set(false);
    this.maybeShowFuelPopup();
  }

  convertNow() {
    this.showConvertPrompt.set(false);
    this.makeCustomer(); // opens the link-customer picker — fuel popup fires once that resolves (closeLinkModal)
  }

  private maybeShowFuelPopup() {
    if (!this.pendingFuelVisitId()) return;
    if (this.settings.expenses()?.fuelReminderOnVisit === false) {
      this.pendingFuelVisitId.set(null);
      return;
    }
    this.showFuelPopup.set(true);
  }

  closeFuelPopup() {
    this.showFuelPopup.set(false);
    this.pendingFuelVisitId.set(null);
  }

  private async loadVisits(shopId: string) {
    try { this.visitHistory.set(await this.visits.listForShop(shopId)); }
    catch (e) { console.error('Load visits failed', e); }
  }

  toggleVisit(id: string) {
    this.expandedVisitId.set(this.expandedVisitId() === id ? null : id);
  }

  visitDateOf(v: Visit): Date {
    const d: any = v.visitDate;
    return d?.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
  }

  restock() {
    const s = this.shop();
    if (!s || !s.linkedCustomerId) return;
    const last = this.visitHistory()[0];
    const items = (last?.items || [])
      .filter(it => it.productId && (it.added ?? 0) > 0);
    
    if (items.length === 0) {
      this.toast.error('No restocked items on the latest visit to reorder.');
      return;
    }

    const draftItems = items.map(it => {
      const p = this.products().find(prod => prod.id === it.productId);
      if (!p) return null;
      const added = it.added!;
      return {
        productId: p.id,
        productName: p.name,
        productSku: p.sku,
        quantity: added,
        unitPriceCents: p.priceCents,
        unitCostCents: p.costCents,
        lineTotalCents: added * p.priceCents,
        lineCostCents: added * p.costCents,
        currencyCode: 'CAD'
      };
    }).filter(Boolean);

    if (draftItems.length === 0) {
      this.toast.error('Could not match restocked items to active products.');
      return;
    }

    const draft = {
      customerId: s.linkedCustomerId,
      items: draftItems,
      taxRatePercent: 13,
      deliveryType: 'delivery',
      sourceOrderNumber: 'visit restock',
      sourceVisitId: last.id,
    };
    localStorage.setItem('tropx_reorder_draft', JSON.stringify(draft));
    this.router.navigate(['/admin/orders/new']);
  }
}
