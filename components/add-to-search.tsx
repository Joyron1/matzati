"use client";

import { Plus } from "lucide-react";
import { keepPricesTogether } from "@/lib/format";
import { COMPOSER_INPUT_ID } from "./search-composer";

/**
 * A typed example under "איך לחפש": a click adds its text to the home page composer and moves the
 * focus there, so the visitor can edit it and search. It never submits, so it never starts a
 * (paid) search.
 */
export function AddToSearch({ text }: { text: string }) {
  function add() {
    const field = document.getElementById(COMPOSER_INPUT_ID);
    if (!(field instanceof HTMLTextAreaElement)) return;
    const current = field.value.trim().replace(/[\s,]+$/, "");
    if (!current.includes(text)) {
      const next = current ? `${current}, ${text}` : text;
      if (field.maxLength < 0 || next.length <= field.maxLength) field.value = next;
    }
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
    field.scrollIntoView({ block: "center" });
  }

  return (
    <button
      type="button"
      onClick={add}
      className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border border-line bg-bg ps-2.5 pe-3 text-start text-sm font-medium text-ink hover:border-accent hover:text-accent-ink"
    >
      <Plus aria-hidden className="size-4 shrink-0 text-accent-ink" strokeWidth={2.25} />
      {keepPricesTogether(text)}
      <span className="sr-only">, הוספה לחיפוש</span>
    </button>
  );
}
