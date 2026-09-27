// Home page guidance under the search: how to phrase a search ("איך לחפש") and ready queries to
// try ("רעיונות לחיפוש"). Everything here must stay true to what the search does: it understands
// free Hebrew, prices in shekels (a floor and a ceiling), stated requirements and who a gift is
// for; the trust filters are ours, so nobody needs to ask for them.
import Link from "next/link";
import {
  Backpack,
  Baby,
  Car,
  ChevronLeft,
  Compass,
  Gift,
  House,
  Lightbulb,
  Plane,
  Speaker,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { keepPricesTogether } from "@/lib/format";
import { searchHref } from "@/lib/search-url";
import { AddToSearch } from "./add-to-search";
import { card } from "./styles";

const TIPS: { title: string; examples: string[] }[] = [
  { title: "כתבו מה צריך, במילים פשוטות", examples: ["אוזניות לריצה", "מארגן למגירות"] },
  { title: "הוסיפו תקציב בשקלים", examples: ["עד 100 ש״ח", "בין 50 ל־150 ש״ח"] },
  { title: "ציינו מה חשוב לכם", examples: ["עמיד למים", "שקט", "מתקפל"] },
  { title: "מחפשים מתנה? כתבו למי ומה אוהבים", examples: ["מתנה לילדה בת 8", "לאבא שאוהב לבשל"] },
];

/** The first three tips in one query (also the composer's placeholder). */
const FULL_EXAMPLE = "אוזניות לריצה, עמידות למים, עד 100 ש״ח";

// Mostly queries from the parse eval (fixtures/llm) and the earlier home page examples, so each
// is known to parse well. One per topic.
const IDEAS: { topic: string; Icon: LucideIcon; q: string }[] = [
  { topic: "מתנות", Icon: Gift, q: "מתנה לאבא שאוהב לבשל עד 200 ש״ח" },
  { topic: "בית", Icon: House, q: "מארגנים למגירות במטבח" },
  { topic: "רכב", Icon: Car, q: "מחזיק טלפון לרכב עם טעינה אלחוטית" },
  { topic: "ילדים", Icon: Baby, q: "מנורת לילה לחדר ילדים עם חיישן תנועה" },
  { topic: "טכנולוגיה", Icon: Speaker, q: "רמקול בלוטות׳ עמיד למים בין 50 ל־150 ש״ח" },
  { topic: "ספורט", Icon: Watch, q: "שעון חכם עם מד דופק עד 150 ש״ח" },
  { topic: "טיולים", Icon: Backpack, q: "תיק גב עמיד למים לטיולים" },
  { topic: "טיסות", Icon: Plane, q: "כרית צוואר לטיסות ארוכות" },
];

/** The shared header of both cards: an icon badge and the card's heading. */
function CardHeader({ id, Icon, title }: { id: string; Icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
        <Icon aria-hidden className="size-5" />
      </span>
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
    </div>
  );
}

export function SearchTips() {
  return (
    <section aria-labelledby="tips-title" className={`${card} flex flex-col p-4 sm:p-7`}>
      <CardHeader id="tips-title" Icon={Lightbulb} title="איך לחפש" />
      <p className="mt-2 leading-relaxed text-pretty text-muted">
        כתבו בעברית, כמו שמסבירים לחבר. לא צריך לבקש ״דירוג גבוה״: אנחנו בודקים משוב של קונים ומספר
        מכירות בכל חיפוש.
      </p>
      <p className="mt-2 text-sm font-medium text-ink">לחצו על דוגמה כדי להוסיף אותה לחיפוש.</p>
      <ol className="mt-5 mb-6 space-y-5">
        {TIPS.map((tip, i) => (
          <li key={tip.title} className="flex gap-3">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold text-ink"
            >
              {i + 1}
            </span>
            <div className="min-w-0 space-y-2">
              <p className="font-semibold text-pretty">{tip.title}</p>
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
        // noindex anyway (same as the hot-search pills).
        rel="nofollow"
        prefetch={false}
        className="group mt-auto flex items-center gap-3 rounded-tile border border-transparent bg-accent-soft p-4 hover:border-accent"
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
    </section>
  );
}

export function SearchIdeas() {
  return (
    <section aria-labelledby="ideas-title" className={`${card} p-4 sm:p-7`}>
      <CardHeader id="ideas-title" Icon={Compass} title="רעיונות לחיפוש" />
      <p className="mt-2 leading-relaxed text-pretty text-muted">
        לא בטוחים מה לכתוב? לחצו על רעיון ונחפש אותו.
      </p>
      {/* One column at every width: from the tablet up each query fits on one line. */}
      <ul className="mt-5 grid gap-2">
        {IDEAS.map(({ topic, Icon, q }) => (
          <li key={q} className="min-w-0">
            <Link
              // Not typed by the visitor, so never listed on /searches.
              href={searchHref({ q, from: "example" })}
              // Crawlers may follow this page, and an expired search costs a new run; the target
              // is noindex anyway (same as the hot-search pills).
              rel="nofollow"
              prefetch={false}
              className="group flex h-full min-h-14 items-center gap-3 rounded-tile border border-line bg-surface px-3 py-2 hover:border-accent"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
                <Icon aria-hidden className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-muted">{topic}</span>
                <span className="block leading-snug font-medium text-pretty text-ink group-hover:text-accent-ink">
                  {keepPricesTogether(q)}
                </span>
              </span>
              {/* The whole row is the link; the chevron only helps on wider screens. */}
              <ChevronLeft aria-hidden className="hidden size-4 shrink-0 text-muted sm:block" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
