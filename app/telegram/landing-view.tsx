// The /telegram landing page's content (./page.tsx), for a given join link: also the dev preview's
// (/dev/telegram-landing).
import Link from "next/link";
import { ChevronDown, MessageSquareText, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { card } from "@/components/styles";
import { GroupPreview } from "@/components/telegram-join";
import { TelegramMark } from "@/components/telegram-mark";
import { AFFILIATE_SECTION_ID, LEGAL_PATHS } from "@/lib/config/legal";
import { FILTERS } from "@/lib/ranking/config";
import { JoinButton } from "./join-button";

const CTA = "כן! אני רוצה להצטרף בחינם";
const FREE_NOTE = "חינם · בלי הרשמה באתר · אפשר לעזוב מתי שרוצים";

const STEPS = [
  {
    Icon: TelegramMark,
    title: "מצטרפים בקליק",
    body: "לוחצים על הכפתור, הקבוצה נפתחת בטלגרם, ומצטרפים. בלי טופס ובלי להשאיר פרטים.",
  },
  {
    Icon: MessageSquareText,
    title: "כותבים מה מחפשים",
    body: "בעברית חופשית, כמו שהייתם שואלים חבר: ״מנורת לילה לחדר ילדים עד 50 ש״ח״.",
  },
  {
    Icon: Sparkles,
    title: "מקבלים את 5 הכי טובים",
    body: "הסוכן שלנו מחפש באלי אקספרס ומחזיר תמונה אחת עם המוצרים המתאימים, כל אחד עם מחיר, משוב, מכירות וקישור.",
  },
];

function Hero({ href, dailyLimit }: { href: string; dailyLimit: number }) {
  return (
    <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-5 text-center lg:text-start">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-tg-soft px-3 py-1 text-sm font-semibold text-tg-ink">
          <TelegramMark className="size-4" />
          קבוצת טלגרם חינמית
        </p>
        <h1 className="font-display text-4xl leading-tight text-balance sm:text-5xl">
          כותבים מה מחפשים, ומקבלים את המוצרים הכי שווים מאלי אקספרס
        </h1>
        <p className="text-lg leading-relaxed text-pretty text-muted">
          במקום לגלול שעות באלי אקספרס: כותבים בקבוצה בעברית, והסוכן של מצאתי מחזיר אחרי כמה שניות
          את 5 המוצרים הכי מתאימים, מסודרים לפי אמינות. עד {dailyLimit} חיפושים ביום לכל חבר.
        </p>
        <div className="space-y-2">
          <JoinButton href={href} label={CTA} />
          <p className="text-sm text-muted">{FREE_NOTE}</p>
        </div>
      </div>
      <div aria-hidden className="mx-auto w-full max-w-sm rounded-card bg-tg-soft p-5 shadow-soft">
        <GroupPreview />
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section aria-labelledby="tg-how" className="space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-sm font-semibold text-tg-ink">איך זה עובד</p>
        <h2 id="tg-how" className="font-display text-3xl text-balance">
          שלושה צעדים, בלי לחפש לבד
        </h2>
      </div>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(({ Icon, title, body }, i) => (
          <li key={title} className={`${card} space-y-3 p-5`}>
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-tg-to to-tg text-white">
                <Icon aria-hidden className="size-6" />
              </span>
              <h3 className="text-lg font-bold">
                <span className="text-tg-ink">{i + 1}.</span> {title}
              </h3>
            </div>
            <p className="leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Why() {
  const points = [
    {
      Icon: ShieldCheck,
      title: "רק מוצרים שעברו סינון",
      body: `קודם מוצרים עם ${FILTERS.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות ${FILTERS.minUnitsSold} מכירות בחודש האחרון. כל המספרים מאלי אקספרס.`,
    },
    {
      Icon: Sparkles,
      title: "בדיוק מה שביקשתם",
      body: "מוצר מהסוג שכתבתם, בתקציב שכתבתם. ואם יש קוד הנחה של אלי אקספרס למוצר, הוא מופיע ליד המחיר.",
    },
    {
      Icon: Trash2,
      title: "קבוצה נקייה",
      body: "רק חיפושים ותשובות. הודעה שהיא לא חיפוש נמחקת אוטומטית אחרי כמה שניות.",
    },
  ];
  return (
    <section aria-labelledby="tg-why" className="space-y-6">
      <h2 id="tg-why" className="text-center font-display text-3xl text-balance">
        למה דווקא בקבוצה של מצאתי
      </h2>
      <ul className="grid gap-4 md:grid-cols-3">
        {points.map(({ Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <Icon aria-hidden className="mt-1 size-6 shrink-0 text-tg-ink" />
            <div className="space-y-1">
              <h3 className="font-bold">{title}</h3>
              <p className="leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Numbers({ href, dailyLimit }: { href: string; dailyLimit: number }) {
  const facts = [
    { value: "0 ₪", label: "עלות ההצטרפות" },
    { value: "5", label: "המוצרים הכי מתאימים בכל תשובה" },
    { value: String(dailyLimit), label: "חיפושים ביום לכל חבר" },
  ];
  return (
    <section
      aria-label="בקצרה"
      className="space-y-6 rounded-card bg-gradient-to-br from-tg-to to-tg px-5 py-8 text-center text-white sm:px-8"
    >
      <dl className="grid gap-6 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="flex flex-col-reverse gap-1">
            <dt className="text-white/90">{f.label}</dt>
            <dd className="text-4xl font-bold">
              <bdi>{f.value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mx-auto max-w-xl text-lg font-semibold text-balance">
        מוכנים לחסוך זמן בחיפושים?
      </p>
      <JoinButton href={href} label={CTA} light />
    </section>
  );
}

function Faq({ dailyLimit }: { dailyLimit: number }) {
  const items = [
    {
      q: "האם הקבוצה באמת חינמית?",
      a: "כן. ההצטרפות והחיפושים חינם. כשקונים דרך הקישורים שלנו, אלי אקספרס משלמת לנו עמלה, והמחיר שלכם לא משתנה.",
    },
    {
      q: "כמה הודעות מקבלים?",
      a: `רק מה שחברי הקבוצה מחפשים והתשובות של הסוכן. כל חבר יכול לחפש עד ${dailyLimit} פעמים ביום. אפשר להשתיק את הקבוצה ולחפש רק כשצריך.`,
    },
    {
      q: "צריך להירשם או להשאיר פרטים?",
      a: "לא. מספיק חשבון טלגרם. אנחנו לא מקבלים את מספר הטלפון שלכם.",
    },
    {
      q: "אפשר לעזוב מתי שרוצים?",
      a: "כן, יוצאים מהקבוצה בטלגרם בלחיצה, בלי לשאול אף אחד.",
    },
    {
      q: "איך מצטרפים?",
      a: "לוחצים על הכפתור הכחול. טלגרם נפתח עם הקבוצה, ולוחצים ״הצטרפות״. אין לכם טלגרם? מורידים אותו חינם מחנות האפליקציות.",
    },
  ];
  return (
    <section aria-labelledby="tg-faq" className="mx-auto max-w-3xl space-y-4">
      <h2 id="tg-faq" className="text-center font-display text-3xl">
        שאלות נפוצות
      </h2>
      <div className="space-y-2">
        {items.map((item) => (
          <details key={item.q} className={`${card} group p-0`}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                aria-hidden
                className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <p className="px-5 pb-4 leading-relaxed text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** The page for a given join link (also the dev preview's). */
export function TelegramLandingView({ href, dailyLimit }: { href: string; dailyLimit: number }) {
  return (
    <div className="mx-auto max-w-6xl space-y-14 px-4 pt-8 pb-16 sm:space-y-20 sm:px-6 sm:pt-12">
      <Hero href={href} dailyLimit={dailyLimit} />
      <Steps />
      <Why />
      <Numbers href={href} dailyLimit={dailyLimit} />
      <Faq dailyLimit={dailyLimit} />
      <section className="space-y-3 text-center">
        <JoinButton href={href} label={CTA} />
        <p className="text-sm text-muted">{FREE_NOTE}</p>
        <p className="text-sm text-muted">
          הקישורים לאלי אקספרס הם קישורי שותפים.{" "}
          <Link
            href={`${LEGAL_PATHS.terms}#${AFFILIATE_SECTION_ID}`}
            className="underline underline-offset-4"
          >
            מה זה אומר
          </Link>
        </p>
      </section>
    </div>
  );
}
