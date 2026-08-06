import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';
import { DEFAULT_STUCK_THRESHOLDS } from '../../../../../shared/utils/pipeline.utils';

@Component({
  selector: 'app-pipeline-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pipeline-card.component.html',
})
export class PipelineCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);

  editingPipeline = signal(false);
  isSaving = signal(false);

  plEnabled = signal(true);
  plToVisit = signal(DEFAULT_STUCK_THRESHOLDS.to_visit);
  plFirstContact = signal(DEFAULT_STUCK_THRESHOLDS.first_contact);
  plManagerMeeting = signal(DEFAULT_STUCK_THRESHOLDS.manager_meeting);
  plSampleLeft = signal(DEFAULT_STUCK_THRESHOLDS.sample_left);
  plDecision = signal(DEFAULT_STUCK_THRESHOLDS.decision);
  plOpened = signal(DEFAULT_STUCK_THRESHOLDS.opened);

  constructor() {
    effect(() => {
      const r = this.settings.reconciliation();
      const pl = (r as any).pipeline || {};
      const st = pl.stuckThresholds || {};
      this.plEnabled.set(pl.enabled !== false);
      this.plToVisit.set(st.to_visit ?? DEFAULT_STUCK_THRESHOLDS.to_visit);
      this.plFirstContact.set(st.first_contact ?? DEFAULT_STUCK_THRESHOLDS.first_contact);
      this.plManagerMeeting.set(st.manager_meeting ?? DEFAULT_STUCK_THRESHOLDS.manager_meeting);
      this.plSampleLeft.set(st.sample_left ?? DEFAULT_STUCK_THRESHOLDS.sample_left);
      this.plDecision.set(st.decision ?? DEFAULT_STUCK_THRESHOLDS.decision);
      this.plOpened.set(st.opened ?? DEFAULT_STUCK_THRESHOLDS.opened);
    }, { allowSignalWrites: true });
  }

  async savePipeline() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/reconciliation', {
        pipeline: {
          enabled: this.plEnabled(),
          stuckThresholds: {
            to_visit: this.plToVisit(),
            first_contact: this.plFirstContact(),
            manager_meeting: this.plManagerMeeting(),
            sample_left: this.plSampleLeft(),
            decision: this.plDecision(),
            opened: this.plOpened(),
          },
        },
      });
      this.toast.success('Pipeline settings saved');
      this.editingPipeline.set(false);
    } catch (e) { console.error(e); this.toast.error('Failed to save'); }
    finally { this.isSaving.set(false); }
  }

  cancelPipeline() {
    const r = this.settings.reconciliation();
    const pl = (r as any).pipeline || {};
    const st = pl.stuckThresholds || {};
    this.plEnabled.set(pl.enabled !== false);
    this.plToVisit.set(st.to_visit ?? DEFAULT_STUCK_THRESHOLDS.to_visit);
    this.plFirstContact.set(st.first_contact ?? DEFAULT_STUCK_THRESHOLDS.first_contact);
    this.plManagerMeeting.set(st.manager_meeting ?? DEFAULT_STUCK_THRESHOLDS.manager_meeting);
    this.plSampleLeft.set(st.sample_left ?? DEFAULT_STUCK_THRESHOLDS.sample_left);
    this.plDecision.set(st.decision ?? DEFAULT_STUCK_THRESHOLDS.decision);
    this.plOpened.set(st.opened ?? DEFAULT_STUCK_THRESHOLDS.opened);
    this.editingPipeline.set(false);
  }
}
