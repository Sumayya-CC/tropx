import { PipelineStage } from '../../core/models/shop.model';

export const PIPELINE_STAGES: PipelineStage[] = [
  'to_visit', 'first_contact', 'manager_meeting', 'sample_left', 'decision', 'opened',
];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  to_visit: 'To Visit',
  first_contact: 'First Contact',
  manager_meeting: 'Manager Meeting',
  sample_left: 'Sample Left',
  decision: 'Decision',
  opened: 'Opened',
};

export interface StuckThresholds {
  to_visit: number;
  first_contact: number;
  manager_meeting: number;
  sample_left: number;
  decision: number;
  opened: number;
}

export const DEFAULT_STUCK_THRESHOLDS: StuckThresholds = {
  to_visit: 10, first_contact: 7, manager_meeting: 10, sample_left: 14, decision: 7, opened: 3,
};

/** Index of a stage in the forward funnel (0..4). */
export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

/** True if `to` is strictly further along than `from`. */
export function isForward(from: PipelineStage, to: PipelineStage): boolean {
  return stageIndex(to) > stageIndex(from);
}
