import Link from "next/link";
import {
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { ResultsPreview } from "@/components/results-preview";
import { SaleCountdown } from "@/components/sale-countdown";
import { SearchComposer } from "@/components/search-composer";
import { card } from "@/components/styles";
import { BRAND } from "@/lib/config/brand";
import { NEXT_SALE } from "@/lib/mock/deals";
import { EXAMPLE_QUERY, getMockSearch } from "@/lib/mock/search";
import { FILTERS } from "@/lib/ranking/config";
import { searchHref } from "@/lib/search-url";

const EXAMPLES = [
  "מתנה לילדה בת 8 עד 150 ש״ח",
  "מחזיק טלפון לרכב עם טעינה אלחוטית",
  "תיק גב עמיד למים לטיולים",
  "מארגנים למגירות במטבח",
  "מנורת לילה לחדר ילדים",
];

const STEPS = [
  {
    Icon: MessageSquareText,
    title: "כותבים בעברית",
    body: "מה צריך, למי ובאיזה תקציב. לא צריך לנחש מילות חיפוש באנגלית.",
  },
  {
    Icon: SlidersHorizontal,
    title: "אנחנו מסננים",
    body: `רק מוצרים עם ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות ${FILTERS.minUnitsSold} מכירות. כל המספרים מגיעים מאלי אקספרס.`,
  },
  {
    Icon: ListChecks,
    title: "בוחרים מתוך 3",
    body: "ליד כל מוצר כתוב למה הוא נבחר. אפשר להסיר סינון ולחפש שוב בלחיצה.",
  },
];

export default function HomePage() {
  const example = getMockSearch({ q: EXAMPLE_QUERY, without: [], sort: "best_value" }).response;

  return (
    <>
      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 pt-8 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:items-start lg:gap-14">
        <div className="space-y-7">
          <div className="space-y-4">
            <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1.5 text-sm font-semibold text-accent-ink">
              <Sparkles aria-hidden className="size-4" />
              {BRAND.tagline}
            </p>
            <h1 className="font-display text-[2.15rem] leading-[1.15] text-ink sm:text-5xl lg:text-[2.75rem]">
              <span className="block text-balance">כתבו מה אתם צריכים.</span>
              <span className="block text-balance text-accent">קבלו 3 מוצרים שעברו סינון.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted">
              אנחנו בודקים עד 100 מוצרים באלי אקספרס, מסננים לפי משוב של קונים ומספר מכירות, ומראים
              רק את מה שעבר.
            </p>
          </div>

          <SearchComposer />

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted">נסו למשל:</h2>
            <ul className="flex flex-wrap gap-2">
              {EXAMPLES.map((q) => (
                <li key={q}>
                  <Link
                    href={searchHref({ q })}
                    className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-accent hover:text-accent-ink"
                  >
                    {q}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <ResultsPreview response={example} />
      </section>

      <section aria-labelledby="how-title" className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <h2 id="how-title" className="font-display text-3xl">
          איך זה עובד
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map(({ Icon, title, body }, i) => (
            <li key={title} className={`${card} space-y-3 p-6`}>
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent-ink">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="text-sm font-bold text-muted">שלב {i + 1}</span>
              </div>
              <h3 className="text-lg font-bold">{title}</h3>
              <p className="leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="mx-auto mt-6 grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-2">
        <SaleCountdown title={NEXT_SALE.title_he} startsAt={NEXT_SALE.starts_at} />
        <section aria-labelledby="trust-title" className={`${card} flex flex-col gap-4 p-6 sm:p-7`}>
          <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <ShieldCheck aria-hidden className="size-5" />
          </span>
          <h2 id="trust-title" className="font-display text-3xl">
            איך אנחנו מרוויחים
          </h2>
          <p className="leading-relaxed text-muted">
            כשאתם קונים דרך הקישורים שלנו, אלי אקספרס משלמת לנו עמלה קטנה. המחיר שלכם לא משתנה.
            העמלה לא משפיעה על הדירוג: מוצר לא יעלה למעלה רק כי הוא משלם לנו יותר.
          </p>
          <Link
            href="/disclosure"
            className="mt-auto inline-flex min-h-11 items-center self-start font-semibold text-accent-ink underline-offset-4 hover:underline"
          >
            לגילוי הנאות המלא
          </Link>
        </section>
      </div>
    </>
  );
}
