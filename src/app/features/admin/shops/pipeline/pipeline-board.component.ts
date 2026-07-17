import { Component, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { where } from '@angular/fire/firestore';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { PipelineService } from '../../../../core/services/pipeline.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { Shop, PipelineStage } from '../../../../core/models/shop.model';
import {
  PIPELINE_STAGES, PIPELINE_STAGE_LABELS, DEFAULT_STUCK_THRESHOLDS, StuckThresholds,
} from '../../../../shared/utils/pipeline.utils';
import { HEALTH_BAND_TONE, HEALTH_BAND_LABELS, HealthBand } from '../../../../shared/utils/shop-health.utils';

interface StageColumn {
  stage: PipelineStage;
  label: string;
  shops: Shop[];
}

@Component({
  selector: 'app-pipeline-board',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './pipeline-board.component.html',
  styleUrl: './pipeline-board.component.scss',
})
export class PipelineBoardComponent {
  private readonly firestore = inject(FirestoreService);
  private readonly pipeline = inject(PipelineService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  protected readonly router = inject(Router);

  readonly stages = PIPELINE_STAGES;
  readonly stageLabels = PIPELINE_STAGE_LABELS;

  prospects = signal<Shop[]>([]);
  convertedShops = signal<Shop[]>([]);
  isLoading = signal(true);
  filterStuckOnly = signal(false);
  filterQuery = signal('');
  movingId = signal<string | null>(null);

  constructor() { this.load(); }

  private load() {
    this.firestore.getCollection<Shop>(
      'shops',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false),
      where('status', '==', 'prospect'),
    ).subscribe({
      next: d => { this.prospects.set(d); this.isLoading.set(false); },
      error: e => { console.error(e); this.isLoading.set(false); },
    });

    this.firestore.getCollection<Shop>('shops',
      where('tenantId','==',1), where('isDeleted','==',false),
      where('status','==','customer'),
    ).subscribe({ next: d => this.convertedShops.set(d.filter(s => (s.pipelineHistory?.length || 0) > 0)), error: () => {} });
  }

  private thresholds(): StuckThresholds {
    const p = (this.settings.reconciliation() as any).pipeline || {};
    const st = p.stuckThresholds || {};
    return {
      to_visit: st.to_visit ?? DEFAULT_STUCK_THRESHOLDS.to_visit,
      first_contact: st.first_contact ?? DEFAULT_STUCK_THRESHOLDS.first_contact,
      manager_meeting: st.manager_meeting ?? DEFAULT_STUCK_THRESHOLDS.manager_meeting,
      sample_left: st.sample_left ?? DEFAULT_STUCK_THRESHOLDS.sample_left,
      decision: st.decision ?? DEFAULT_STUCK_THRESHOLDS.decision,
      opened: st.opened ?? DEFAULT_STUCK_THRESHOLDS.opened,
    };
  }

  // Live days-in-stage from pipelineEnteredStageAt (fresh, not the nightly-stamped value).
  daysInStage(shop: Shop): number | null {
    const v: any = shop.pipelineEnteredStageAt;
    if (!v) return null;
    const then = v?.toDate ? v.toDate().getTime() : new Date(v).getTime();
    if (isNaN(then)) return null;
    return Math.max(0, Math.floor((Date.now() - then) / 86400000));
  }

  isStuck(shop: Shop): boolean {
    const days = this.daysInStage(shop);
    if (days == null) return false;
    const t = this.thresholds();
    const threshold = (t as any)[shop.pipelineStage || 'to_visit'] ?? 14;
    return days > threshold;
  }

  healthTone(shop: Shop): string {
    const band = (shop.healthBand || 'unknown') as HealthBand;
    return HEALTH_BAND_TONE[band];
  }
  healthLabel(shop: Shop): string {
    const band = (shop.healthBand || 'unknown') as HealthBand;
    return HEALTH_BAND_LABELS[band];
  }

  nextActionDue(shop: Shop): 'overdue' | 'today' | 'upcoming' | null {
    const v: any = shop.nextActionDate;
    if (!v) return null;
    const d = v?.toDate ? v.toDate() : new Date(v);
    if (isNaN(d.getTime())) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(d); target.setHours(0,0,0,0);
    if (target < today) return 'overdue';
    if (target.getTime() === today.getTime()) return 'today';
    return 'upcoming';
  }
  nextActionLabel(shop: Shop): string {
    const v: any = shop.nextActionDate;
    if (!v) return '';
    const d = v?.toDate ? v.toDate() : new Date(v);
    const dateStr = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    return shop.nextActionNote ? `${dateStr} · ${shop.nextActionNote}` : dateStr;
  }

  overview = computed(() => {
    const all = this.prospects();
    const active = all.length;
    const stuck = all.filter(s => this.isStuck(s)).length;
    const ready = all.filter(s => s.pipelineStage === 'opened').length;

    // Avg days to convert: for converted shops, time from first history entry to 'opened' (or last).
    const converted = this.convertedShops();
    let avgDays: number | null = null;
    if (converted.length) {
      const spans: number[] = [];
      for (const s of converted) {
        const hist = s.pipelineHistory || [];
        if (hist.length < 1) continue;
        const start: any = hist[0].enteredAt;
        const openedEntry = hist.find(h => h.stage === 'opened') || hist[hist.length - 1];
        const end: any = openedEntry.enteredAt;
        const sMs = start?.toDate ? start.toDate().getTime() : new Date(start).getTime();
        const eMs = end?.toDate ? end.toDate().getTime() : new Date(end).getTime();
        if (!isNaN(sMs) && !isNaN(eMs) && eMs >= sMs) spans.push(Math.floor((eMs - sMs) / 86400000));
      }
      if (spans.length) avgDays = Math.round(spans.reduce((a,b)=>a+b,0) / spans.length);
    }

    // Conversion rate: converted / (converted + active prospects + not_interested? ) — keep simple:
    // converted / (converted + active).
    const rate = (converted.length + active) > 0
      ? Math.round((converted.length / (converted.length + active)) * 100) : 0;

    return { active, stuck, ready, avgDays, rate, convertedCount: converted.length };
  });

  needsAttention = computed(() => {
    const stuck = this.prospects().filter(s => this.isStuck(s))
      .map(s => ({ shop: s, reason: `${this.daysInStage(s)}d in ${this.stageLabels[s.pipelineStage || 'to_visit']}`, kind: 'stuck' as const }));
    const overdue = this.prospects().filter(s => this.nextActionDue(s) === 'overdue')
      .map(s => ({ shop: s, reason: `follow-up overdue`, kind: 'overdue' as const }));
    // de-dupe (a shop can be both); prefer overdue label
    const seen = new Set<string>();
    return [...overdue, ...stuck].filter(x => seen.has(x.shop.id) ? false : (seen.add(x.shop.id), true)).slice(0, 10);
  });

  readyToConvert = computed(() =>
    this.prospects().filter(s => s.pipelineStage === 'opened')
      .sort((a,b) => (this.daysInStage(b) ?? 0) - (this.daysInStage(a) ?? 0)));

  todaysFollowUps = computed(() =>
    this.prospects().filter(s => {
      const due = this.nextActionDue(s); return due === 'today' || due === 'overdue';
    }).sort((a,b) => {
      const av: any = a.nextActionDate, bv: any = b.nextActionDate;
      const at = av?.toDate ? av.toDate().getTime() : new Date(av).getTime();
      const bt = bv?.toDate ? bv.toDate().getTime() : new Date(bv).getTime();
      return at - bt;
    }));

  columns = computed<StageColumn[]>(() => {
    const q = this.filterQuery().trim().toLowerCase();
    const stuckOnly = this.filterStuckOnly();
    let list = this.prospects();
    if (q) list = list.filter(s =>
      s.name.toLowerCase().includes(q) || (s.address?.city || '').toLowerCase().includes(q));
    if (stuckOnly) list = list.filter(s => this.isStuck(s));
    return this.stages.map(stage => ({
      stage,
      label: this.stageLabels[stage],
      shops: list.filter(s => (s.pipelineStage || 'to_visit') === stage)
        .sort((a, b) => (this.daysInStage(b) ?? 0) - (this.daysInStage(a) ?? 0)),
    }));
  });

  async onStageChange(shop: Shop, newStage: string) {
    const stage = newStage as PipelineStage;
    if (stage === shop.pipelineStage) return;
    this.movingId.set(shop.id);
    try {
      await this.pipeline.changeStage(shop, stage);
      this.toast.success(`${shop.name} → ${this.stageLabels[stage]}`);
      // optimistic local update so the card jumps columns immediately
      this.prospects.update(list => list.map(s =>
        s.id === shop.id ? { ...s, pipelineStage: stage, pipelineEnteredStageAt: new Date() as any } : s));
    } catch (e) {
      console.error(e); this.toast.error('Failed to move stage');
    } finally { this.movingId.set(null); }
  }

  convert(shop: Shop, ev: Event) {
    ev.stopPropagation();
    // Reuse the existing shop-detail convert flow by navigating there; the detail page's
    // "Make Customer" picker handles the actual link. (Keeps one conversion path.)
    this.router.navigate(['/admin/shops', shop.id], { queryParams: { convert: '1' } });
  }

  goToShop(id: string) { this.router.navigate(['/admin/shops', id]); }
}
