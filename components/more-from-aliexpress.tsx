"use client";

import { useEffect, useRef, useState } from "react";
import type { LoggedResult } from "@/lib/search-url";
import { MORE_STEP } from "@/lib/config/site";
import { StandardProductCard } from "./product-cards";
import { RevealList } from "./reveal-list";
import { btnMd, btnSecondary } from "./styles";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; results: LoggedResult[]; ranks: number[] }
  | { kind: "failed"; text: string };

/**
 * "עוד מוצרים שמצאנו באלי אקספרס" under a smart search's results (owner request 2026-10-19): the
 * other products the simple search finds for the same query, in AliExpress's order, after the ones
 * that passed our filters. Loaded once the section comes near the screen (one AliExpress call, no
 * LLM; POST /api/search/aliexpress), or with its button; says plainly that these did not pass, or
 * were not checked by, our filters. Renders nothing when there is nothing more to show.
 */
export function MoreFromAliExpress({
  q,
  cat,
  exclude,
}: {
  q: string;
  cat?: string;
  /** The smart result set's filters_key: its products are not shown again. */
  exclude?: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const ref = useRef<HTMLElement>(null);

  async function load() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/search/aliexpress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, ...(cat ? { cat } : {}), ...(exclude ? { exclude } : {}) }),
      });
      if (res.status === 429) {
        setState({ kind: "failed", text: "הגעתם למגבלת החיפושים. נסו שוב מאוחר יותר." });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { results: LoggedResult[]; ranks: number[] };
      setState({ kind: "done", results: data.results, ranks: data.ranks });
    } catch {
      setState({ kind: "failed", text: "לא הצלחנו לטעון עוד מוצרים מאלי אקספרס. נסו שוב." });
    }
  }

  // Loads once, when the section is about a screen away; without an observer the button does.
  useEffect(() => {
    const el = ref.current;
    if (!el || state.kind !== "idle" || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // load is stable enough for one run: it only reads the props this section was keyed by.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  if (state.kind === "done" && !state.results.length) return null;

  return (
    <section ref={ref} aria-labelledby="more-from-aliexpress" className="space-y-3 pt-4">
      <div className="space-y-1 border-t border-line pt-6">
        <h2 id="more-from-aliexpress" className="text-lg font-bold">
          עוד מוצרים שמצאנו באלי אקספרס
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          אלה לא עברו את הסינון שלנו, או שלא בדקנו אותם: מוצגים כמו שאלי אקספרס מחזירה אותם, לפי
          מספר המכירות, בלי ההסבר ״למה בחרנו״. שמות המוצרים בתרגום אוטומטי של אלי אקספרס.
        </p>
      </div>
      {state.kind === "done" ? (
        <RevealList
          initial={MORE_STEP}
          step={MORE_STEP}
          className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5"
          items={state.results.map((p, i) => (
            <li key={p.product_id}>
              <StandardProductCard
                product={p}
                rank={state.ranks[i] ?? i + 1}
                q={q}
                src="search_aliexpress"
                rankOf="באלי אקספרס"
              />
            </li>
          ))}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 py-4">
          {state.kind === "failed" && (
            <p role="alert" className="text-sm text-muted">
              {state.text}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              if (state.kind !== "loading") void load();
            }}
            aria-disabled={state.kind === "loading"}
            className={`${btnSecondary} ${btnMd} aria-disabled:opacity-60`}
          >
            {state.kind === "loading"
              ? "טוענים מוצרים מאלי אקספרס…"
              : "הצגת מוצרים נוספים מאלי אקספרס"}
          </button>
        </div>
      )}
    </section>
  );
}
