import { Component, Input, computed, signal } from '@angular/core';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  template: `
    <span class="status-badge" [class]="badgeClass()">
      {{ displayLabel() }}
    </span>
  `,
  styleUrl: './status-badge.component.scss'
})
export class StatusBadgeComponent {
  private _status = signal<string>('');
  private _color = signal<string | null>(null);
  private _label = signal<string | null>(null);
  
  @Input() set status(val: string) {
    this._status.set(val || '');
  }

  @Input() set color(val: string | null) {
    this._color.set(val);
  }

  @Input() set label(val: string | null) {
    this._label.set(val);
  }

  badgeClass = computed(() => {
    if (this._color()) {
      return `badge-${this._color()}`;
    }

    const s = this._status().toLowerCase();
    const success = ['active', 'approved', 'paid', 'delivered', 'received', 'return_from_customer', 'in_stock'];
    const warning = ['pending', 'partial', 'low_stock', 'correction', 'other', 'sample', 'out_for_delivery'];
    const danger = ['inactive', 'rejected', 'suspended', 'voided', 'unpaid', 'damaged', 'expired', 'lost', 'out_of_stock', 'cancelled'];
    const info = ['manager', 'warehouse', 'sales_rep', 'confirmed'];

    if (success.includes(s)) return 'badge-success';
    if (warning.includes(s)) return 'badge-warning';
    if (danger.includes(s)) return 'badge-danger';
    if (info.includes(s)) return 'badge-info';
    return 'badge-gray';
  });

  displayLabel = computed(() => {
    if (this._label()) {
      return this._label();
    }
    const s = this._status();
    if (!s) return 'Unknown';
    return s.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  });
}
