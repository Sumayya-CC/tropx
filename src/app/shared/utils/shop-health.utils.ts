export type HealthBand =
  | 'healthy' | 'watch' | 'at_risk'   // customers
  | 'warm' | 'cooling' | 'cold'       // prospects
  | 'unknown';                         // no data yet

export interface HealthThresholds {
  customerWatchDays: number;    // default 30
  customerAtRiskDays: number;   // default 60
  prospectCoolingDays: number;  // default 14
  prospectColdDays: number;     // default 45
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  customerWatchDays: 30,
  customerAtRiskDays: 60,
  prospectCoolingDays: 14,
  prospectColdDays: 45,
};

/** Whole days between a past date and now (>=0). Null date → null. */
export function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null;
  const then = date instanceof Date ? date : new Date(date);
  if (isNaN(then.getTime())) return null;
  const ms = Date.now() - then.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

/**
 * Health for a CUSTOMER shop, from days since last order.
 * atRiskOverride (shop.inactiveDaysOverride) overrides the global at-risk cutoff.
 */
export function customerHealth(
  daysSinceOrder: number | null,
  t: HealthThresholds,
  atRiskOverride?: number,
): HealthBand {
  if (daysSinceOrder == null) return 'unknown';
  const atRisk = atRiskOverride ?? t.customerAtRiskDays;
  if (daysSinceOrder >= atRisk) return 'at_risk';
  if (daysSinceOrder >= t.customerWatchDays) return 'watch';
  return 'healthy';
}

/** Health for a PROSPECT shop, from days since last visit. */
export function prospectHealth(
  daysSinceVisit: number | null,
  t: HealthThresholds,
): HealthBand {
  if (daysSinceVisit == null) return 'unknown';
  if (daysSinceVisit >= t.prospectColdDays) return 'cold';
  if (daysSinceVisit >= t.prospectCoolingDays) return 'cooling';
  return 'warm';
}

export const HEALTH_BAND_LABELS: Record<HealthBand, string> = {
  healthy: 'Healthy', watch: 'Watch', at_risk: 'At Risk',
  warm: 'Warm', cooling: 'Cooling', cold: 'Cold', unknown: 'No Data',
};

// Maps each band to a semantic color token used across badges/cards.
export const HEALTH_BAND_TONE: Record<HealthBand, 'green' | 'gold' | 'red' | 'gray'> = {
  healthy: 'green', watch: 'gold', at_risk: 'red',
  warm: 'green', cooling: 'gold', cold: 'red', unknown: 'gray',
};
