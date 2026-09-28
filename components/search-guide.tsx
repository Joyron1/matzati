// Home page guidance: how to phrase a search (the first answer of "שאלות נפוצות",
// components/home-faq.tsx) and ready queries to try ("רעיונות לחיפוש", under the hot products).
// Everything here must stay true to what the search does: it understands free Hebrew, prices in
// shekels (a floor and a ceiling), stated requirements and who a gift is for; the trust filters
// are ours, so nobody needs to ask for them.
import Link from "next/link";
import {
  Backpack,
  Baby,
  Car,
  ChevronLeft,
  Compass,
  Gift,
  House,
  Plane,
  Speaker,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { keepPricesTogether } from "@/lib/format";
import { searchHref } from "@/lib/search-url";
import { AddToSearch } from "./add-to-search";

const TIPS_INTRO =
  "כתבו בעברית, כמו שמסבירים לחבר. לא צריך לבקש ״דירוג גבוה״: אנחנו בודקים משוב של קונים ומספר מכירות בכל חיפוש.";

const TIPS: { title: string; examples: string[] }[] = [
  { title: "כתבו מה צריך, במילים פשוטות", examples: ["אוזניות לריצה", "מארגן למגירות"] },
  { title: "הוסיפו תקציב בשקלים", examples: ["עד 100 ש״ח", "בין 50 ל־150 ש״ח"] },
  { title: "ציינו מה חשוב לכם", examples: ["עמיד למים", "שקט", "מתקפל"] },
  { title: "מחפשים מתנה? כתבו למי ומה אוהבים", examples: ["מתנה לילדה בת 8", "לאבא שאוהב לבשל"] },
];

/** The first three tips in one query (also the composer's placeholder). */
const FULL_EXAMPLE = "אוזניות לריצה, עמידות למים, עד 100 ש״ח";

// Mostly queries from the parse eval (fixtures/llm) and the earlier home page examples, so each
// is known to parse well. One per topic: gifts, home, car, kids, tech, sport, trips, flights.
const IDEAS: { Icon: LucideIcon; q: string }[] = [
  { Icon: Gift, q: "מתנה לאבא שאוהב לבשל עד 200 ש״ח" },
  { Icon: House, q: "מארגנים למגירות במטבח" },
  { Icon: Car, q: "מחזיק טלפון לרכב עם טעינה אלחוטית" },
  { Icon: Baby, q: "מנורת לילה לחדר ילדים עם חיישן תנועה" },
  { Icon: Speaker, q: "רמקול בלוטות׳ עמיד למים בין 50 ל־150 ש״ח" },
  { Icon: Watch, q: "שעון חכם עם מד דופק עד 150 ש״ח" },
  { Icon: Backpack, q: "תיק גב עמיד למים לטיולים" },
  { Icon: Plane, q: "כרית צוואר לטיסות ארוכות" },
];

/** "איך מחפשים נכון?" as plain text, for the FAQ's structured data: the words SearchTipsAnswer shows. */
export function searchTipsText(): string {
  const tips = TIPS.map(
    (tip, i) => `${i + 1}. ${tip.title}: ${tip.examples.map((ex) => `״${ex}״`).join(", ")}.`,
  );
  return [TIPS_INTRO, ...tips, `הכול ביחד: ״${FULL_EXAMPLE}״.`].join(" ");
}

/**
 * The answer to "איך מחפשים נכון?": four tips whose examples add their text to the composer at the
 * top of the page (AddToSearch scrolls there and focuses it), then one full example to search.
 * Fragments like "שקט" are not searches of their own, so they are not links.
 */
export function SearchTipsAnswer() {
  return (
    <div>
      <p className="text-pretty">{TIPS_INTRO}</p>
      <p className="mt-2 text-sm font-medium text-ink">
        לחצו על דוגמה כדי להוסיף אותה לתיבת החיפוש.
      </p>
      <ol className="mt-4 mb-5 space-y-4">
        {TIPS.map((tip, i) => (
          <li key={tip.title} className="flex gap-3">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold text-ink"
            >
              {i + 1}
            </span>
            <div className="min-w-0 space-y-2">
              <p className="font-semibold text-pretty text-ink">{tip.title}</p>
              <ul className="flex flex-wrap gap-1.5">
                {tip.examples.map((ex) => (
                  <li key={ex} className="max-w-full">
                    <AddToSearch text={ex} />
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      <Link
        // Not typed by the visitor, so never listed on /searches.
        href={searchHref({ q: FULL_EXAMPLE, from: "example" })}
        // Crawlers may follow this page, and an expired search costs a new run; the target is
        // noindex anyway (same as the hot-search tiles).
        rel="nofollow"
        prefetch={false}
        className="group flex items-center gap-3 rounded-tile border border-transparent bg-accent-soft p-4 hover:border-accent"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-muted">הכול ביחד</span>
          <span className="mt-0.5 block font-semibold text-pretty text-ink">
            ״{keepPricesTogether(FULL_EXAMPLE)}״
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent-ink group-hover:underline">
          לחיפוש
          <ChevronLeft aria-hidden className="size-4" />
        </span>
      </Link>
    </div>
  );
}

/** "רעיונות לחיפוש": one row of ready queries (wrapping on narrow screens), each a search link. */
export function SearchIdeas() {
  return (
    <section aria-labelledby="ideas-title" className="mx-auto max-w-6xl px-4 sm:px-6">
      <h2
        id="ideas-title"
        className="flex items-center justify-center gap-2 font-display text-2xl text-ink"
      >
        <Compass aria-hidden className="size-6 shrink-0 text-accent-ink" />
        רעיונות לחיפוש
      </h2>
      <p className="mt-1 text-center text-pretty text-muted">
        לא בטוחים מה לכתוב? לחצו על רעיון ונחפש אותו.
      </p>
      <ul className="mt-4 flex flex-wrap justify-center gap-2">
        {IDEAS.map(({ Icon, q }) => (
          <li key={q} className="max-w-full">
            <Link
              // Not typed by the visitor, so never listed on /searches.
              href={searchHref({ q, from: "example" })}
              // Crawlers may follow this page, and an expired search costs a new run; the target
              // is noindex anyway (same as the hot-search tiles).
              rel="nofollow"
              prefetch={false}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-line bg-surface py-1 ps-1 pe-4 text-sm font-medium text-ink hover:border-accent hover:text-accent-ink"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="text-pretty">{keepPricesTogether(q)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
