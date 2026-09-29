import type { Metadata } from "next";
import Link from "next/link";
import { CookieSettingsButton } from "@/components/cookie-consent/cookie-settings-button";
import { LegalSection, StaticPage, type PageSection } from "@/components/static-page";
import { btnMd, btnSecondary, card } from "@/components/styles";
import { BRAND } from "@/lib/config/brand";
import { AFFILIATE_SECTION_ID, LEGAL_PATHS } from "@/lib/config/legal";
import {
  consentCategories,
  storageInventory,
  type ConsentCategoryInfo,
  type StorageItem,
} from "@/lib/consent/categories";
import { CONSENT_COOKIE } from "@/lib/consent/consent";
import { googleAnalyticsId } from "@/lib/settings/queries";
import { pageMetadata } from "@/lib/seo/page-meta";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "מדיניות עוגיות",
    description: `אילו עוגיות ומידע האתר ״${BRAND.name}״ שומר בדפדפן, למה, לכמה זמן, ואיך משנים את הבחירה.`,
    path: "/cookies",
  }),
};

const KIND_LABEL: Record<StorageItem["kind"], string> = {
  cookie: "עוגייה",
  localStorage: "אחסון מקומי בדפדפן (localStorage)",
};

const categoryLabel = (categories: readonly ConsentCategoryInfo[], id: StorageItem["category"]) =>
  categories.find((c) => c.id === id)?.label ?? id;

const SEC = {
  inUse: { id: "in-use", title: "מה נשמר בדפדפן" },
  categories: { id: "categories", title: "סוגי העוגיות וההסכמה" },
  notUsed: { id: "not-used", title: "מה אין באתר" },
  aliexpress: { id: "aliexpress", title: "אחרי מעבר לאלי אקספרס" },
  choices: { id: "choices", title: "איך משנים את הבחירה" },
} as const satisfies Record<string, PageSection>;

function StorageCard({
  item,
  categories,
}: {
  item: StorageItem;
  categories: readonly ConsentCategoryInfo[];
}) {
  const rows: [string, string][] = [
    ["סוג", KIND_LABEL[item.kind]],
    ["קטגוריה", categoryLabel(categories, item.category)],
    ["למי", item.who],
    ["למה", item.purpose],
    ["לכמה זמן", item.duration],
    ...(item.provider ? [["ספק", item.provider] as [string, string]] : []),
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

// Google Analytics is described only while the owner has set its id (/admin/settings): the page
// reads the same cached setting as the root layout, so it stays static and changes with it.
export default async function CookiesPage() {
  const measurementId = await googleAnalyticsId();
  const analytics = measurementId !== null;
  const categories = consentCategories(analytics);
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
          {analytics ? (
            <p>
              בקצרה: אנחנו שומרים מה שהכרחי כדי שהאתר יעבוד ויזכור בחירות שעשיתם. אם תאשרו עוגיות
              סטטיסטיקה, נפעיל גם את Google Analytics, שמודד את השימוש באתר. בלי האישור שלכם הוא לא
              נטען. אין באתר עוגיות פרסום.
            </p>
          ) : (
            <p>
              בקצרה: היום אנחנו שומרים רק מה שהכרחי כדי שהאתר יעבוד ויזכור בחירות שעשיתם. אין באתר
              עוגיות של סטטיסטיקה, פרסום או צד שלישי.
            </p>
          )}
        </>
      }
    >
      <LegalSection {...SEC.inUse}>
        <div className="grid gap-4">
          {storageInventory(measurementId).map((item) => (
            <StorageCard key={item.name} item={item} categories={categories} />
          ))}
        </div>
        <p>עוגיות ממשק הניהול נשמרות רק אצל מי שנכנס לעמודי הניהול. גולשים באתר לא מקבלים אותן.</p>
        {analytics && (
          <p>
            עוגיות Google Analytics נשמרות רק אצל מי שאישר עוגיות סטטיסטיקה. הן נשמרות בדומיין של
            האתר, והמידע שבהן נשלח ל־Google. מה בדיוק נשלח מפורט ב
            <Link href={`${LEGAL_PATHS.privacy}#tracking`}>מדיניות הפרטיות</Link>.
          </p>
        )}
      </LegalSection>

      <LegalSection {...SEC.categories}>
        <ul>
          {categories.map((category) => (
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
          ל־12 חודשים, ואז נשאל שוב.{" "}
          {analytics
            ? "Google Analytics פועל רק אחרי שאישרתם סטטיסטיקה. אם נוסיף כלי שיווק, הוא יפעל רק אחרי שתאשרו אותו, נעדכן את העמוד הזה ונשאל אתכם מחדש."
            : "אם נוסיף כלי סטטיסטיקה שמשתמש בעוגיות, או כלי שיווק, הוא יפעל רק אחרי שתאשרו אותו, נעדכן את העמוד הזה ונשאל אתכם מחדש."}
        </p>
      </LegalSection>

      <LegalSection {...SEC.notUsed}>
        {/* components/share-link.tsx and whatsapp-cta.tsx are plain wa.me links: nothing loads
            from WhatsApp until one is followed. */}
        <p>
          {analytics
            ? "אין באתר פיקסלים של רשתות פרסום, תוספים שנטענים מרשתות חברתיות או סקריפטים של צד שלישי, מלבד Google Analytics, שנטען מהשרתים של Google רק אחרי שאישרתם עוגיות סטטיסטיקה."
            : "אין באתר פיקסלים של רשתות פרסום, תוספים שנטענים מרשתות חברתיות או סקריפטים של צד שלישי."}{" "}
          את הביקורים בעמודים אנחנו סופרים בכלי של ספק האחסון (Vercel Web Analytics), שנטען מהדומיין
          של האתר ולא שומר בדפדפן עוגיות או מידע אחר; הפירוט ב
          <Link href={`${LEGAL_PATHS.privacy}#tracking`}>מדיניות הפרטיות</Link>. כפתור השיתוף
          לוואטסאפ והקישור לערוץ הוואטסאפ הם קישורים רגילים, ושום דבר לא נטען מוואטסאפ עד שלוחצים
          עליהם. הגופנים מוגשים מהשרתים של האתר. תמונות המוצרים נטענות ישירות משרתי התמונות של אלי
          אקספרס, בלי עוגיות מהדומיין של האתר; מה אלי אקספרס מקבלת בכך מפורט ב
          <Link href={`${LEGAL_PATHS.privacy}#sharing`}>מדיניות הפרטיות</Link>.
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
        {analytics && (
          <p>
            ביטול ההסכמה לסטטיסטיקה עוצר מיד את השליחה ל־Google Analytics ומוחק את עוגיות{" "}
            <bdi dir="ltr" className="font-mono">
              _ga
            </bdi>{" "}
            מהדפדפן. הסקריפט עצמו יורד מהעמוד בטעינה הבאה שלו.
          </p>
        )}
        <CookieSettingsButton className={`${btnSecondary} ${btnMd} print:hidden`} />
        <p>
          אפשר גם למחוק עוגיות ונתוני אתרים בהגדרות הדפדפן. אחרי מחיקה נשאל שוב על העוגיות, וערכת
          הצבעים תחזור להיות לפי הגדרות המכשיר.
        </p>
      </LegalSection>
    </StaticPage>
  );
}
