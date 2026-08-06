import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AdminDashboardDataService } from '../../admin-dashboard-data.service';

// NOTE: pipelineSummary() on the data service duplicates stuck/stage
// logic that also lives in PipelineService — flagged, not fixed, per
// the plan's explicit D6 scope (a bigger reconciliation than this
// split's job; deferred as its own separate look).
@Component({
  selector: 'app-pipeline-summary-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './pipeline-summary-card.component.html',
  styleUrl: './pipeline-summary-card.component.scss',
})
export class PipelineSummaryCardComponent {
  protected readonly data = inject(AdminDashboardDataService);
}
