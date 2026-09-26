// Filter thresholds. Defaults are to be tuned against real data (M4).
// The UI reads these too, so the numbers we show always match the numbers we use.
export const FILTERS = {
  minPositiveFeedbackPct: 90,
  minUnitsSold: 100,
} as const;
