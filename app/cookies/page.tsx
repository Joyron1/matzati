import type { Metadata } from "next";
import Link from "next/link";
import { CookieSettingsButton } from "@/components/cookie-consent/cookie-settings-button";
import { LegalSection, StaticPage, type PageSection } from "@/components/static-page";
import { btnMd, btnSecondary, card } from "@/components/styles";
import { BRAND } from "@/lib/config/brand";
import { AFFILIATE_SECTION_ID, LEGAL_PATHS } from "@/lib/config/legal";
import { CONSENT_CATEGORIES, STORAGE_INVENTORY, type StorageItem } from "@/lib/consent/categories";
import { CONSENT_COOKIE } from "@/lib/consent/consent";

export const metadata: Metadata = {
  title: "מדיניות עוגיות",
  description: `אילו עוגיות ומידע האתר ״${BRAND.name}״ שומר בדפדפן, למה, לכמה זמן, ואיך משנים את הבחירה.`,
};

const KIND_LABEL: Record<StorageItem["kind"], string> = {
  cookie: "עוגייה",
  localStorage: "אחסון מקומי בדפדפן (localStorage)",
};

const categoryLabel = (id: StorageItem["category"]) =>
  CONSENT_CATEGORIES.find((c) => c.id === id)?.label ?? id;

const SEC = {
  inUse: { id: "in-use", title: "מה נשמר בדפדפן" },
  categories: { id: "categories", title: "סוגי העוגיות וההסכמה" },
  notUsed: { id: "not-used", title: "מה אין באתר" },
  aliexpress: { id: "aliexpress", title: "אחרי מעבר לאלי אקספרס" },
  choices: { id: "choices", title: "איך משנים את הבחירה" },
} as const satisfies Record<string, PageSection>;

function StorageCard({ item }: { item: StorageItem }) {
  const rows: [string, string][] = [
    ["סוג", KIND_LABEL[item.kind]],
    ["קטגוריה", categoryLabel(item.category)],
    ["למי", item.who],
    ["למה", item.purpose],
    ["לכמה זמן", item.duration],
  ];
  return (
    <div className={`${card} p-5`}>
      <h3 className="pt-0!">
        <bdi dir="ltr" className="font-mono text-base break-all">
          {item.name}
        </bdi>
      </h3>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-[15px] sm:grid-cols-[7rem_1fr]">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="font-semibold text-muted">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function CookiesPage() {
  return (
    <StaticPage
      page="cookies"
      sections={Object.values(SEC)}
      intro={
        <>
          <p>
            עוגייה (cookie) היא קובץ טקסט קטן שאתר שומר בדפדפן. אתרים יכולים לשמור מידע גם באחסון
            המקומי של הדפדפן. כאן מפורט כל מה שהאתר שומר בדפדפן שלכם, ולמה.
          </p>
          <p>
            בקצרה: היום אנחנו שומרים רק מה שהכרחי כדי שהאתר יעבוד ויזכור בחירות שעשיתם. אין באתר
            עוגיות של סטטיסטיקה, פרסום או צד שלישי.
          </p>
        </>
      }
    >
      <LegalSection {...SEC.inUse}>
        <div className="grid gap-4">
          {STORAGE_INVENTORY.map((item) => (
            <StorageCard key={item.name} item={item} />
          ))}
        </div>
        <p>עוגיות ממשק הניהול נשמרות רק אצל מי שנכנס לעמודי הניהול. גולשים באתר לא מקבלים אותן.</p>
      </LegalSection>

      <LegalSection {...SEC.categories}>
        <ul>
          {CONSENT_CATEGORIES.map((category) => (
            <li key={category.id}>
              <span className="font-semibold">{category.label}:</span> {category.description}{" "}
              {category.id === "necessary"
                ? "לא נדרשת להן הסכמה."
                : category.inUse
                  ? "פועלות רק אחרי שאישרתם אותן."
                  : "לא בשימוש כרגע."}
            </li>
          ))}
        </ul>
        <p>
          את הבחירה שלכם בהודעת העוגיות אנחנו שומרים בעוגייה{" "}
          <bdi dir="ltr" className="font-mono">
            {CONSENT_COOKIE}
          </bdi>{" "}
          ל־12 חודשים, ואז נשאל שוב. אם נוסיף כלי סטטיסטיקה או שיווק, הוא יפעל רק אחרי שתאשרו אותו,
          נעדכן את העמוד הזה ונשאל אתכם מחדש.
        </p>
      </LegalSection>

      <LegalSection {...SEC.notUsed}>
        {/* components/share-link.tsx and whatsapp-cta.tsx are plain wa.me links: nothing loads
            from WhatsApp until one is followed. */}
        <p>
          אין באתר כלי אנליטיקה, פיקסלים של רשתות פרסום, תוספים שנטענים מרשתות חברתיות או סקריפטים
          של צד שלישי. כפתור השיתוף לוואטסאפ והקישור לערוץ הוואטסאפ הם קישורים רגילים, ושום דבר לא
          נטען מוואטסאפ עד שלוחצים עליהם. הגופנים ותמונות המוצרים מוגשים מהשרתים של האתר.
        </p>
      </LegalSection>

      <LegalSection {...SEC.aliexpress}>
        <p>
          כשאתם לוחצים על כפתור קנייה או על הקישור לביקורות, אתם עוברים לאתר של אלי אקספרס. גם סרטון
          מוצר נטען מאלי אקספרס, רק כשאתם מפעילים אותו. אלי אקספרס שומרת עוגיות משלה בדומיין שלה,
          בין השאר כדי לשייך קנייה לקישור השותפים שלנו, לפי מדיניות העוגיות והפרטיות שלה. אין לנו
          גישה לעוגיות האלה ואין לנו שליטה עליהן. כך גם וואטסאפ, אם תפתחו אותו בכפתור שיתוף.
        </p>
        <p>
          עוד על הקישורים האלה ב
          <Link href={`${LEGAL_PATHS.terms}#${AFFILIATE_SECTION_ID}`}>גילוי הנאות</Link>, ועל המידע
          שהאתר שומר ב<Link href={LEGAL_PATHS.privacy}>מדיניות הפרטיות</Link>.
        </p>
      </LegalSection>

      <LegalSection {...SEC.choices}>
        <p>אפשר לשנות את הבחירה בכל רגע: בכפתור כאן, או בקישור ״הגדרות עוגיות״ בתחתית כל עמוד.</p>
        <CookieSettingsButton className={`${btnSecondary} ${btnMd} print:hidden`} />
        <p>
          אפשר גם למחוק עוגיות ונתוני אתרים בהגדרות הדפדפן. אחרי מחיקה נשאל שוב על העוגיות, וערכת
          הצבעים תחזור להיות לפי הגדרות המכשיר.
        </p>
      </LegalSection>
    </StaticPage>
  );
}
