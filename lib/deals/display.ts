// How each deal type looks, shared by the public board and the admin pages. A plain module (no
// "use client"), so server components get real values rather than client references.
import { Ban, CalendarClock, Tag, type LucideIcon } from "lucide-react";
import type { DealType } from "@/lib/types";

interface DealTypeDisplay {
  /** Filter button on /deals (plural). */
  label: string;
  /** Tag on a card. */
  tagLabel: string;
  /** Choice in the admin form, with a one-line hint. */
  formLabel: string;
  formHint: string;
  Icon: LucideIcon;
  /** Tag colors. */
  tag: string;
}

export const DEAL_TYPE_DISPLAY: Record<DealType, DealTypeDisplay> = {
  deal: {
    label: "דילים",
    tagLabel: "דיל",
    formLabel: "דיל",
    formHint: "מוצר במחיר טוב, אפשר גם עם קופון.",
    Icon: Tag,
    tag: "bg-gold text-on-gold",
  },
  holiday: {
    label: "חגים ומבצעים",
    tagLabel: "חגים ומבצעים",
    formLabel: "חג או מבצע",
    formHint: "מבצע גדול באלי אקספרס. הקרוב ביותר מוצג בדף הבית עם ספירה לאחור.",
    Icon: CalendarClock,
    tag: "bg-accent-soft text-accent-ink",
  },
  dont_buy: {
    label: "לא לקנות",
    tagLabel: "לא לקנות",
    formLabel: "לא לקנות",
    formHint: "אזהרה ממוצרים שעדיף לוותר עליהם.",
    Icon: Ban,
    tag: "bg-invert-bg text-invert-ink",
  },
};

export const DEAL_TYPE_TAG =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap";
