import { Component, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { where, orderBy, limit } from '@angular/fire/firestore';
import { FirestoreService } from '../../../core/services/firestore.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';

interface BannerClick {
  id: string;
  slideId: string;
  buttonLabel: string;
  buttonLink: string;
  customerId: string | null;
  businessName: string | null;
  clickedAt: any;
  tenantId: number;
}

@Component({
  selector: 'app-banner-clicks',
  standalone: true,
  imports: [RouterLink, PageHeaderComponent],
  templateUrl: './banner-clicks.component.html',
  styleUrl: './banner-clicks.component.scss',
})
export class BannerClicksComponent {
  private readonly firestore = inject(FirestoreService);
  clicks = signal<BannerClick[]>([]);
  isLoading = signal(true);

  constructor() {
    this.firestore.getCollection<BannerClick>(
      'bannerClicks',
      where('tenantId', '==', 1),
      orderBy('clickedAt', 'desc'),
      limit(500),
    ).subscribe({
      next: d => { this.clicks.set(d); this.isLoading.set(false); },
      error: e => { console.error(e); this.isLoading.set(false); },
    });
  }

  // Aggregate by button label + link (the meaningful unit — "what did they click").
  byButton = computed(() => {
    const m = new Map<string, { label: string; link: string; count: number; lastAt: any }>();
    for (const c of this.clicks()) {
      const key = `${c.buttonLabel}||${c.buttonLink}`;
      const cur = m.get(key) || { label: c.buttonLabel || '(no label)', link: c.buttonLink, count: 0, lastAt: c.clickedAt };
      cur.count++;
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  });

  totalClicks = computed(() => this.clicks().length);
  uniqueShops = computed(() => new Set(this.clicks().map(c => c.customerId).filter(Boolean)).size);

  clickDate(ts: any): string {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  recent = computed(() => this.clicks().slice(0, 50));
}
