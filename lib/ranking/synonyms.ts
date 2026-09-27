// Seller phrasings that mean the same requirement (CLAUDE.md §6.5). They live in code, not in the
// parse prompt, so matching stays deterministic and every group is unit-tested. A requirement
// whose phrase normalizes to a member of a group also accepts every other member of that group.
// Keep the list small: each entry widens what counts as "the title states it".
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // "ipx" is a prefix term: it matches IPX4 to IPX8.
  ["waterproof", "water proof", "water resistant", "ipx", "ip67", "ip68"],
  ["leak proof", "leakproof", "spill proof", "spillproof", "non spill", "anti leak"],
  ["silent", "quiet", "mute", "noiseless"],
  // "charger" and "charging" stem alike, so "wireless charger" is covered by the first entry.
  ["wireless charging", "wireless charge"],
  ["heart rate", "heartrate", "pulse monitor"],
  ["motion sensor", "motion activated", "body sensor", "body induction", "pir"],
  ["noise cancelling", "noise canceling", "noise cancellation", "anc"],
  // PD (Power Delivery) and QC (Quick Charge, also "qc3") are the fast-charging standards.
  ["fast charging", "fast charge", "quick charge", "quick charging", "pd", "qc"],
  ["foldable", "folding", "collapsible"],
];
