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
  
  @Input() set status(val: string) {
    this._status.set(val || '');
  }

  badgeClass = computed(() => {
    const s = this._status().toLowerCase();
    const success = ['active', 'approved', 'paid', 'delivered', 'received', 'return_from_customer', 'in_stock'];
    const warning = ['pending', 'partial', 'low_stock', 'correction', 'other', 'sample'];
    const danger = ['inactive', 'rejected', 'suspended', 'voided', 'unpaid', 'damaged', 'expired', 'lost', 'out_of_stock'];
    const info = ['manager', 'warehouse', 'sales_rep'];

    if (success.includes(s)) return 'badge-success';
    if (warning.includes(s)) return 'badge-warning';
    if (danger.includes(s)) return 'badge-danger';
    if (info.includes(s)) return 'badge-info';
    return 'badge-gray';
  });

  displayLabel = computed(() => {
    const s = this._status();
    if (!s) return 'Unknown';
    return s.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  });
}
