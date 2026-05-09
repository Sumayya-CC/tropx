import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  template: `
    <span class="status-badge" [class]="'status-' + type">
      {{ status }}
    </span>
  `,
  styleUrl: './status-badge.component.scss'
})
export class StatusBadgeComponent {
  @Input({ required: true }) status!: string;
  @Input() type: 'success' | 'warning' | 'danger' | 'gray' | 'info' = 'gray';
}
