// Home page "שאלות נפוצות": short answers to what visitors ask before they search or buy, as native
// <details> (open and close without script), plus the same questions and answers as schema.org
// FAQPage data. The numbers come from lib/ranking/config.ts, so the answers always state the
// thresholds the code runs.
import Link from "next/link";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { hasPublishedCoupons } from "@/lib/coupons/queries";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import { jsonLdScript } from "@/lib/seo/structured-data";
import { SearchTipsAnswer, searchTipsText } from "./search-guide";
import { card } from "./styles";

interface FaqItem {
  /** Also the fragment that links to the question (/#faq-hot). */
  id: string;
  question: string;
  /** The answer's paragraphs as shown, and the structured data's answer text. */
  answer: string[];
  /** Shown instead of `answer` when the answer needs more than text; `answer` is then its words. */
  body?: ReactNode;
  /** A link under the answer. Not part of the structured data: a link is not an answer. */
  more?: ReactNode;
}

const MORE_LINK =
  "inline-flex min-h-11 items-center gap-0.5 font-semibold text-accent-ink underline-offset-4 hover:underline";

function MoreLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={MORE_LINK}>
      {label}
      <ChevronLeft aria-hidden className="size-4" />
    </Link>
  );
}

/** Like the menu and the footer: an empty coupons page is not linked. */
async function CouponsLink() {
  if (!(await hasPublishedCoupons())) return null;
  return <MoreLink href="/coupons" label="לקופונים" />;
}

const TRUST = `${FILTERS.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות ${FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים`;

const FAQ: FaqItem[] = [
  {
    id: "faq-search",
    question: "איך מחפשים נכון?",
    answer: [searchTipsText()],
    body: <SearchTipsAnswer />,
  },
  {
    id: "faq-filters",
    question: "איך בוחרים את המוצרים?",
    // Both tiers (lib/ranking/config.ts): the fill tier only tops up to 3 results.
    answer: [
      `אנחנו מחפשים באלי אקספרס לפי מה שכתבתם ובודקים כל מוצר שחוזר. עובר רק מוצר עם ${TRUST}, מהסוג שביקשתם, בטווח המחיר ועם הדרישות שכתבתם. מוצר שחסרים לו הנתונים האלה לא עובר.`,
      `כשאין מספיק מוצרים כאלה, משלימים עד 3 ממוצרים עם ${FILL_TIER.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות ${FILL_TIER.minUnitsSold} מכירות. את מה שעבר מדרגים לפי המשוב, מספר המכירות וההתאמה למחיר. כל המספרים מאלי אקספרס.`,
    ],
  },
  {
    id: "faq-price",
    question: "המחיר סופי?",
    // price_is_approx: ILS prices come from AliExpress as they are; only a USD fallback is converted.
    answer: [
      "לא תמיד. אנחנו מראים את המחיר שאלי אקספרס החזירה כשבדקנו את המוצר, ומחיר שהמרנו מדולרים מסומן ב־≈ כי הוא משוער. המחירים באלי אקספרס משתנים, והמחיר הסופי מוצג בקופה באלי אקספרס, לפני התשלום.",
      "בעמוד של כל מוצר כתוב מתי בדקנו את המחיר.",
    ],
  },
  {
    id: "faq-affiliate",
    question: "אתם מרוויחים מזה?",
    answer: [
      "כן. כשקונים דרך הקישורים שלנו, אלי אקספרס משלמת לנו עמלה קטנה, בלי תוספת למחיר שלכם. העמלה לא משפיעה על הדירוג: מוצר לא יעלה למעלה רק כי הוא משלם לנו יותר.",
    ],
    more: <MoreLink href="/disclosure" label="לגילוי הנאות המלא" />,
  },
  {
    id: "faq-coupons",
    question: "איך משתמשים בקופון?",
    answer: [
      "מעתיקים את הקוד ומזינים אותו בקופה באלי אקספרס, לפני התשלום. הקופונים שאנחנו מפרסמים מסומנים ״לפי תנאי הקופון״: ההנחה לפי התנאים של כל קופון, וחלק מהקודים מוגבלים בכמות. בדקו בקופה שההנחה התקבלה לפני התשלום.",
    ],
    more: (
      <Suspense fallback={null}>
        <CouponsLink />
      </Suspense>
    ),
  },
  {
    id: "faq-hot",
    question: "מה זה מוצרים חמים?",
    // The hot list is AliExpress's pool of products with a hot commission (docs/aliexpress-api.md,
    // Hot products): the rate was higher than the standard one on most of them.
    answer: [
      `מוצרים שנמכרים הרבה באלי אקספרס, מתוך רשימת המוצרים החמים שאלי אקספרס מפרסמת לשותפים שלה. גם אותם אנחנו מסננים: מוצג רק מוצר עם ${TRUST}. בעמוד המוצרים החמים אפשר לבחור קטגוריה ולסנן.`,
      "על רוב המוצרים ברשימה הזאת אלי אקספרס מציעה לשותפים עמלה גבוהה יותר. המחיר שלכם לא משתנה, והעמלה לא משפיעה על הסינון ועל הסדר.",
    ],
    more: <MoreLink href="/hot" label="למוצרים החמים" />,
  },
];

/** schema.org FAQPage of the questions and answers shown. */
function faqJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer.join(" ") },
    })),
  };
}

export function HomeFaq() {
  return (
    <section aria-labelledby="faq-title" className="mx-auto mt-16 max-w-3xl px-4 sm:mt-20 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd(FAQ)) }}
      />
      <h2 id="faq-title" className="text-center font-display text-3xl">
        שאלות נפוצות
      </h2>
      <div className="mt-6 space-y-3">
        {FAQ.map((item) => (
          <details key={item.id} id={item.id} className={`group ${card}`}>
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-card px-4 py-3 text-lg font-semibold text-ink hover:text-accent-ink sm:px-6 [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown
                aria-hidden
                className="size-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <div className="space-y-3 px-4 pb-5 leading-relaxed text-muted sm:px-6">
              {item.body ??
                item.answer.map((paragraph) => (
                  <p key={paragraph} className="text-pretty">
                    {paragraph}
                  </p>
                ))}
              {item.more}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
