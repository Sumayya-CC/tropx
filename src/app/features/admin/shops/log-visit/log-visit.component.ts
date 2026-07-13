import { Component, inject, signal, computed, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { VisitService } from '../../../../core/services/visit.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Product } from '../../../../core/models/product.model';
import { Shop, VisitItem, Visit } from '../../../../core/models/shop.model';
import { where } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { dateInputToLocalDate, toDateInputValue, todayInputValue } from '../../../../shared/utils/date.utils';

interface EditableItem {
  key: string;              // local row id
  productId?: string;
  productName: string;
  isFreeText: boolean;
  left: number | null;
  found: number | null;
  added: number | null;
  isSample: boolean;
  sampleQty: number | null;
}

@Component({
  selector: 'app-log-visit',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './log-visit.component.html',
  styleUrl: './log-visit.component.scss',
})
export class LogVisitComponent implements OnInit {
  @Input({ required: true }) shop!: Shop;
  @Input() editVisit: Visit | null = null;
  @Input() customerName: string | null = null;
  @Output() saved = new EventEmitter<string>();   // emits new visit id
  @Output() close = new EventEmitter<void>();

  private readonly firestore = inject(FirestoreService);
  private readonly visits = inject(VisitService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  isSaving = signal(false);
  visitDate = signal<string>(todayInputValue());
  rows = signal<EditableItem[]>([]);
  managerAvailable = signal<boolean | null>(null);
  outcome = signal<string>('restocked');
  notes = signal('');
  markedConversion = signal(false);

  // Product catalog + picker
  products = signal<Product[]>([]);
  stockMap = computed(() => {
    const m: Record<string, number> = {};
    this.products().forEach(p => m[p.id] = p.stock);
    return m;
  });
  showPicker = signal(false);
  pickerQuery = signal('');

  // productsOfInterest surfaced first
  interestProducts = computed(() => {
    const ids = new Set(this.shop.productsOfInterest || []);
    return this.products().filter(p => ids.has(p.id));
  });
  filteredCatalog = computed(() => {
    const q = this.pickerQuery().trim().toLowerCase();
    const chosen = new Set(this.rows().map(r => r.productId).filter(Boolean));
    let list = this.products().filter(p => !chosen.has(p.id));
    if (q) list = list.filter(p =>
      p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
    return list.slice(0, 30);
  });

  outcomes = [
    { value: 'restocked', label: 'Restocked' },
    { value: 'ordered', label: 'Ordered' },
    { value: 'no_action', label: 'No action' },
    { value: 'follow_up', label: 'Follow-up' },
    { value: 'sample_left', label: 'Sample left' },
    { value: 'not_interested', label: 'Not interested' },
  ];

  async ngOnInit() {
    // Load active catalog.
    this.products.set(await firstValueFrom(this.firestore.getCollection<Product>(
      'products', where('active', '==', true),
    )));

    if (this.editVisit) {
      const v = this.editVisit;
      const d: any = v.visitDate;
      const dt = d?.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
      this.visitDate.set(toDateInputValue(dt));
      this.rows.set(v.items.map(it => ({
        key: crypto.randomUUID(),
        productId: it.productId,
        productName: it.productName,
        isFreeText: !it.productId,
        left: it.left ?? null, found: it.found ?? null, added: it.added ?? null,
        isSample: !!it.isSample, sampleQty: it.sampleQty ?? null,
      })));
      this.managerAvailable.set(v.managerAvailable ?? null);
      this.outcome.set(v.outcome || 'restocked');
      this.notes.set(v.notes || '');
      this.markedConversion.set(!!v.markedConversion);
      return;   // do not run the last-visit seeding below
    }

    // Auto-fill Left from last visit's (found + added) per catalog product.
    const last = await this.visits.lastForShop(this.shop.id);
    const leftMap: Record<string, number> = {};
    if (last) {
      for (const it of last.items) {
        if (!it.productId) continue;
        leftMap[it.productId] = (it.found ?? 0) + (it.added ?? 0);
      }
    }
    // Seed rows from last visit's catalog items (so you just enter Found/Added).
    if (last && last.items.length) {
      const seeded: EditableItem[] = last.items
        .filter(it => it.productId)
        .map(it => ({
          key: crypto.randomUUID(),
          productId: it.productId,
          productName: it.productName,
          isFreeText: false,
          left: leftMap[it.productId!] ?? null,
          found: null, added: null,
          isSample: false, sampleQty: null,
        }));
      this.rows.set(seeded);
    }
  }

  soldFor(r: EditableItem): number | null {
    if (r.left == null || r.found == null) return null;
    return Math.max(0, r.left - r.found);
  }

  // Non-blocking warning: sampling more than stock (catalog items).
  sampleWarn(r: EditableItem): string | null {
    if (!r.isSample || !r.productId || !r.sampleQty) return null;
    const stock = this.stockMap()[r.productId] ?? 0;
    if (r.sampleQty > stock) {
      return `Sampling ${r.sampleQty} but stock shows ${stock} — recorded, stock will show 0`;
    }
    return null;
  }

  addCatalogItem(p: Product) {
    this.rows.update(rs => [...rs, {
      key: crypto.randomUUID(),
      productId: p.id, productName: p.name, isFreeText: false,
      left: null, found: null, added: null, isSample: false, sampleQty: null,
    }]);
    this.showPicker.set(false);
    this.pickerQuery.set('');
  }

  addFreeTextItem() {
    this.rows.update(rs => [...rs, {
      key: crypto.randomUUID(),
      productName: '', isFreeText: true,
      left: null, found: null, added: null, isSample: false, sampleQty: null,
    }]);
  }

  removeRow(key: string) {
    this.rows.update(rs => rs.filter(r => r.key !== key));
  }

  private toNum(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  patchRow(key: string, patch: Partial<EditableItem>) {
    const coerced: any = { ...patch };
    for (const f of ['left', 'found', 'added', 'sampleQty'] as const) {
      if (f in coerced) coerced[f] = this.toNum(coerced[f]);
    }
    this.rows.update(rs => rs.map(r => r.key === key ? { ...r, ...coerced } : r));
  }

  toggleSample(key: string, on: boolean) {
    this.rows.update(rs => rs.map(r => r.key === key
      ? (on
          ? { ...r, isSample: true, left: null, found: null, added: null }
          : { ...r, isSample: false, sampleQty: null })
      : r));
  }

  onConversionToggle(v: boolean) {
    this.markedConversion.set(v);
    if (v) this.outcome.set('converted');
  }

  async save() {
    const actionBy = this.auth.getActionBy();
    if (!actionBy) {
      this.toast.error('You must be logged in to save a visit.');
      return;
    }
    const validRows = this.rows().filter(r =>
      (r.isFreeText ? r.productName.trim() : r.productId));
    const hasContext =
      validRows.length > 0 ||
      this.notes().trim() !== '' ||
      this.managerAvailable() !== null ||
      this.markedConversion() ||
      this.outcome() !== 'restocked';
    if (!hasContext) {
      this.toast.error('Add an item, a note, or mark an outcome before saving.');
      return;
    }
    this.isSaving.set(true);
    try {
      const items: VisitItem[] = validRows.map(r => ({
        productId: r.isFreeText ? undefined : r.productId,
        productName: r.isFreeText ? r.productName.trim() : r.productName,
        left: r.left ?? undefined,
        found: r.found ?? undefined,
        added: r.added ?? undefined,
        isSample: r.isSample || undefined,
        sampleQty: (r.isSample && r.sampleQty && r.sampleQty > 0) ? r.sampleQty : undefined,
      }));

      const body = {
        visitDate: dateInputToLocalDate(this.visitDate()) ?? new Date(),
        items,
        outcome: this.markedConversion() ? 'converted' : this.outcome(),
        managerAvailable: this.managerAvailable() ?? undefined,
        notes: this.notes().trim() || undefined,
        markedConversion: this.markedConversion(),
      };
      let id: string;
      if (this.editVisit) {
        await this.visits.updateVisit(this.editVisit.id, body);
        id = this.editVisit.id;
        this.toast.success('Visit updated');
      } else {
        id = await this.visits.saveVisit(this.shop.id, this.shop.name, body, actionBy);
        this.toast.success('Visit saved');
      }
      this.saved.emit(id);
    } catch (e) {
      console.error('Save visit failed', e);
      this.toast.error('Failed to save visit');
    } finally {
      this.isSaving.set(false);
    }
  }
}
