import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

@Component({
  selector: 'app-order-status-donut',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './order-status-donut.component.html',
  styleUrl: './order-status-donut.component.scss',
})
export class OrderStatusDonutComponent {
  protected readonly data = inject(AdminDashboardDataService);

  getDonutSegments() {
    const b = this.data.orderStatusBreakdown();
    const total = b.confirmed + b.preparing + b.outForDelivery +
      b.delivered + b.cancelled;
    if (total === 0) return [];

    const data = [
      {
        label: 'Confirmed', count: b.confirmed,
        color: 'var(--navy)'
      },
      {
        label: 'Preparing', count: b.preparing,
        color: '#7c3aed'
      },
      {
        label: 'Out for Delivery', count: b.outForDelivery,
        color: 'var(--gold)'
      },
      {
        label: 'Delivered', count: b.delivered,
        color: 'var(--green)'
      },
      {
        label: 'Cancelled', count: b.cancelled,
        color: 'var(--red)'
      },
    ];

    let angle = -Math.PI / 2;
    const cx = 60, cy = 60, r = 50;

    return data.map(item => {
      const slice = (item.count / total) * 2 * Math.PI;
      const end = angle + slice;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = slice > Math.PI ? 1 : 0;
      const path = item.count === 0 ? '' :
        `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ` +
        `${large} 1 ${x2} ${y2} Z`;
      angle = end;
      return { ...item, path };
    });
  }
}
