"use client";

// The parts of /p that depend on where the visitor came from (owner request 2026-10-08: /p is
// cached for a day per product, so the page itself never reads its query). Both read the address
// in the browser: the back link (to the search, to the hot list, or to a new search) and the
// similar products of that list (GET /api/similar).
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { SimilarProducts } from "@/components/similar-products";
import { firstParam, searchHref } from "@/lib/search-url";
import type { SimilarProducts as SimilarData } from "@/lib/similar/select";

const VISIT_KEYS = ["q", "from", "cat", "sort", "without"] as const;

/** A back link: where it goes and what it says. */
export interface Back {
  href: string;
  label: string;
}

/**
 * The hot lists' back links, made on the server (hotBack in lib/hot/params.ts): by catalog key,
 * and "" for the mix or a link without a known category. Passed as data so the browser bundle of
 * /p does not carry the catalog and ranking modules.
 */
export type HotBacks = Record<string, Back>;

/** Where the back link goes: the search, the hot list (from=hot), or a new search. */
export function backLinkFor(params: URLSearchParams, hotBacks: HotBacks): Back {
  const q = firstParam(params.getAll("q")).trim().slice(0, 200);
  if (q) return { href: searchHref({ q }), label: "חזרה לתוצאות" };
  if (params.get("from") === "hot") return hotBacks[params.get("cat") ?? ""] ?? hotBacks[""];
  return { href: "/", label: "לחיפוש חדש" };
}

const BACK_CLASS =
  "inline-flex min-h-11 items-center gap-1 rounded-full pe-3 font-semibold text-muted hover:text-ink";

/** The link as the server HTML has it: a new search, until the browser reads the address. */
export function DefaultBackLink() {
  return (
    <Link href="/" className={BACK_CLASS}>
      <ChevronRight aria-hidden className="size-5" />
      לחיפוש חדש
    </Link>
  );
}

export function BackLink({ hotBacks }: { hotBacks: HotBacks }) {
  const back = backLinkFor(useSearchParams(), hotBacks);
  return (
    <Link href={back.href} className={BACK_CLASS}>
      <ChevronRight aria-hidden className="size-5" />
      {back.label}
    </Link>
  );
}

/**
 * The similar products of the list the visitor came from, loaded once the page is in the
 * browser. Nothing when the visitor came from neither a search nor a hot list, or nothing is
 * cached for it.
 */
export function SimilarFromVisit({
  productId,
  categoryId,
}: {
  productId: string;
  categoryId: string | null;
}) {
  const params = useSearchParams();
  const fromList = Boolean(params.get("q")?.trim()) || params.get("from") === "hot";
  const query = new URLSearchParams({ id: productId });
  if (categoryId) query.set("category", categoryId);
  for (const key of VISIT_KEYS) for (const value of params.getAll(key)) query.append(key, value);
  const url = `/api/similar?${query}`;
  const [loaded, setLoaded] = useState<{ url: string; data: SimilarData | null } | null>(null);

  useEffect(() => {
    if (!fromList) return;
    let live = true;
    fetch(url)
      .then((res) => (res.ok ? res.json() : { data: null }))
      .then((body: { data?: SimilarData | null }) => {
        if (live) setLoaded({ url, data: body.data ?? null });
      })
      .catch(() => {
        if (live) setLoaded({ url, data: null });
      });
    return () => {
      live = false;
    };
  }, [url, fromList]);

  if (!fromList || loaded?.url !== url) return null;
  return <SimilarProducts data={loaded.data} className="mt-12" />;
}
