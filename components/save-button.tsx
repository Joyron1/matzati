"use client";

// The heart that saves a product to "המוצרים ששמרתי" (lib/saved/mine.ts, this browser only). On a
// card it sits over the photo's corner, above the card's stretched link (aboveCardLink); on the
// product page it is a full button. Before hydration it renders unpressed (the server knows no
// list), so the server HTML never claims a product is saved.
import { Heart } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import {
  forgetProduct,
  parseSaved,
  saveProduct,
  savedText,
  serverSavedText,
  subscribeSaved,
  type SavedProduct,
} from "@/lib/saved/mine";
import { aboveCardLink, btnMd, btnSecondary } from "./styles";

export type SaveSnapshot = Omit<SavedProduct, "at">;

export function useSavedList(): SavedProduct[] {
  const text = useSyncExternalStore(subscribeSaved, savedText, serverSavedText);
  return useMemo(() => parseSaved(text), [text]);
}

export function SaveButton({
  product,
  variant = "icon",
}: {
  product: SaveSnapshot;
  /** "icon": a round heart over a card's photo; "button": a labelled button (the product page). */
  variant?: "icon" | "button";
}) {
  const saved = useSavedList().some((p) => p.id === product.id);
  const toggle = () => (saved ? forgetProduct(product.id) : saveProduct(product));
  const label = saved ? "הסרה מהמוצרים ששמרתי" : "שמירה למוצרים ששמרתי";
  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        className={`${btnSecondary} ${btnMd} gap-2`}
      >
        <Heart
          aria-hidden
          className={`size-[18px] ${saved ? "fill-current text-accent-ink" : ""}`}
        />
        {saved ? "נשמר ברשימה" : "שמירה לרשימה"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={`grid size-11 place-items-center rounded-full bg-surface/90 text-ink shadow-soft backdrop-blur-sm hover:text-accent-ink ${aboveCardLink}`}
    >
      <Heart aria-hidden className={`size-5 ${saved ? "fill-current text-accent-ink" : ""}`} />
    </button>
  );
}
