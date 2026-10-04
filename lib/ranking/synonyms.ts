// Seller phrasings that mean the same requirement (CLAUDE.md §6.5). They live in code, not in the
// parse prompt, so matching stays deterministic and every group is unit-tested. A requirement
// whose phrase normalizes to a member of a group also accepts every other member of that group.
// Keep the list small: each entry widens what counts as "the title states it".
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // "ipx" is a prefix term: it matches IPX4 to IPX8.
  // Not "swimming" (the Lenovo X7 earphones of pair-a): "Swimming Shoes" drain water, and a
  // requirement is matched without knowing the product.
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

// Seller names for the same product, used by the type gate (docs/search-quality-plan.md, item 3).
// A product term that contains a member (as whole words, in order) is also matched with that
// member replaced by every other member of its group: "running earbuds" also matches "Running
// Earphones". Narrow on purpose: a group that is too wide lets a near-miss product through, so
// every group has a test in type-gate.test.ts.
export const PRODUCT_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // In-ear, ear-hook and bone-conduction listings use all four words for the same kind of product.
  ["earbuds", "earphones", "headphones", "headset"],
  ["smartwatch", "smart watch"],
  ["soundbar", "sound bar"],
  ["kitchen utensils", "cooking utensils", "kitchen tools"],
  // "house slides", not "slides": plain slides are summer sandals ("Men Slides Summer Outdoor").
  ["slippers", "house shoes", "house slides"],
  // Not "u shaped pillow": a U-shaped pregnancy or body pillow is not a neck pillow.
  ["neck pillow", "travel pillow"],
  ["color sorting", "color matching"],
];

// One-way product names: a term with the first phrase also matches titles that use the second,
// a kind of it that sellers name on its own, but not the other way round (a cutlery tray is a
// drawer organizer; a search for a cutlery tray does not want a clothes drawer organizer).
// Measured on the snapshots with lib/eval (docs/search-quality-wave-a.md); each has a test in
// type-gate.test.ts.
export const PRODUCT_KINDS: readonly (readonly [string, string])[] = [
  // "Magnetic Wireless Car Charger ... Air Vent Phone Holder": the holder's name comes late.
  ["car phone holder", "wireless car charger"],
  ["drawer organizer", "cutlery tray"],
  ["drawer organizer", "utensil tray"],
];

// One-way close matches: like PRODUCT_KINDS, but the second is near the product, not the product
// itself, so a title matched only this way is a "close" match (ProductMatch.close): it is shown
// after every exact match, the less proven ones included (owner decisions 2026-10-04: "the style
// matters"; for "Naruto pop", Funko POPs first, then other Naruto figures). The character or
// brand is a requirement, so figures of another one still fail.
export const CLOSE_PRODUCT_KINDS: readonly (readonly [string, string])[] = [
  ["pop figure", "action figure"],
  ["pop figure", "anime figure"],
  ["pop figure", "figurine"],
  // Collectible figures sold in mystery boxes ("POP MART Naruto ... Blind Box ... Anime Figure")
  // name the box early and the figure past the opening the type gate reads.
  ["pop figure", "blind box"],
  ["funko pop", "action figure"],
  ["funko pop", "anime figure"],
  ["funko pop", "figurine"],
  ["funko pop", "blind box"],
];
