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
import { publicSettings } from "@/lib/settings/queries";
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
    ...(item.thirdPartyDomain
      ? [
          [
            "איפה",
            `בדומיין ${item.thirdPartyDomain}, של הספק ולא של האתר. האתר לא שומר ולא קורא אותה.`,
          ] as [string, string],
        ]
      : []),
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

/** Inline code (cookie names) kept left to right. */
function Code({ children }: { children: string }) {
  return (
    <bdi dir="ltr" className="font-mono">
      {children}
    </bdi>
  );
}

// Google Analytics and the Meta Pixel are described only while the owner has set their ids
// (/admin/settings): the page reads the same cached settings as the root layout, so it stays
// static and changes with them. Every Meta statement must stay true of
// components/analytics/fbq.ts, meta-pixel.tsx and app/go/[productId]/respond.ts.
export default async function CookiesPage() {
  const { measurementId, metaPixelId } = await publicSettings();
  const analytics = measurementId !== null;
  const marketing = metaPixelId !== null;
  const categories = consentCategories(analytics, marketing);
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
          {marketing ? (
            <p>
              בקצרה: אנחנו שומרים מה שהכרחי כדי שהאתר יעבוד ויזכור בחירות שעשיתם.{" "}
              {analytics &&
                "את השימוש באתר אנחנו מודדים גם עם Google Analytics: בלי אישור הוא פועל בלי עוגיות ובלי מזהה קבוע, ואת העוגיות שלו הוא שומר רק אם תאשרו עוגיות סטטיסטיקה. "}
              כדי למדוד ולפרסם את המודעות שלנו בפייסבוק ובאינסטגרם אנחנו משתמשים ב־Meta Pixel של
              Meta, שנטען ושומר עוגיות רק אם תאשרו עוגיות שיווק. בלי אישור לא נשלח ל־Meta דבר.
            </p>
          ) : analytics ? (
            <p>
              בקצרה: אנחנו שומרים מה שהכרחי כדי שהאתר יעבוד ויזכור בחירות שעשיתם. את השימוש באתר
              אנחנו מודדים גם עם Google Analytics: בלי אישור הוא פועל בלי עוגיות ובלי מזהה קבוע, ואת
              העוגיות שלו הוא שומר רק אם תאשרו עוגיות סטטיסטיקה. אין באתר עוגיות פרסום.
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
          {storageInventory(measurementId, metaPixelId).map((item) => (
            <StorageCard key={item.name} item={item} categories={categories} />
          ))}
        </div>
        <p>עוגיות ממשק הניהול נשמרות רק אצל מי שנכנס לעמודי הניהול. גולשים באתר לא מקבלים אותן.</p>
        <p>
          ״החיפושים שלי״ נשמרים רק בדפדפן שלכם ולא נשלחים אלינו. החיפושים שמוצגים לכל הגולשים בעמוד
          החיפושים האחרונים הם דבר אחר, שמתואר ב
          <Link href={`${LEGAL_PATHS.privacy}#public-searches`}>מדיניות הפרטיות</Link>.
        </p>
        {analytics && (
          <p>
            עוגיות Google Analytics נשמרות רק אצל מי שאישר עוגיות סטטיסטיקה. הן נשמרות בדומיין של
            האתר, והמידע שבהן נשלח ל־Google. בלי אישור, הסקריפט של Google Analytics עדיין נטען ושולח
            ל־Google נתוני שימוש, אבל לא קורא ולא שומר עוגיות. מה בדיוק נשלח, לפני האישור ואחריו,
            מפורט ב<Link href={`${LEGAL_PATHS.privacy}#tracking`}>מדיניות הפרטיות</Link>.
          </p>
        )}
        {marketing && (
          <p>
            עוגיות Meta Pixel (<Code>_fbp</Code>, ו־<Code>_fbc</Code> אם הגעתם מלחיצה בפייסבוק או
            באינסטגרם) נשמרות רק אצל מי שאישר עוגיות שיווק. הן נשמרות בדומיין של האתר, והמידע שבהן
            נשלח ל־Meta. בלי אישור, הסקריפט של Meta לא נטען בכלל ולא נשלח אליה דבר. העוגייה{" "}
            <Code>fr</Code> ועוגיות אחרות של Meta שמורות בדומיין של Meta (facebook.com), לא בדומיין
            של האתר: אנחנו לא שומרים ולא קוראים אותן, אבל כשהפיקסל פונה ל־Meta הדפדפן שולח לה אותן,
            והיא משתמשת בהן לפי מדיניות העוגיות שלה. מה בדיוק נשלח ל־Meta מפורט ב
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
                  ? "העוגיות שלה נשמרות רק אחרי שאישרתם אותן."
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
          {marketing
            ? `${analytics ? "את Google Analytics אנחנו מפעילים בלי עוגיות אצל כל המבקרים, ואת העוגיות שלו רק אחרי שאישרתם סטטיסטיקה. " : ""}את Meta Pixel אנחנו מפעילים רק אחרי שאישרתם שיווק. אם נוסיף כלי אחר, הוא יפעל רק אחרי שתאשרו אותו, נעדכן את העמוד הזה ונשאל אתכם מחדש.`
            : analytics
              ? "את Google Analytics אנחנו מפעילים בלי עוגיות אצל כל המבקרים, ואת העוגיות שלו רק אחרי שאישרתם סטטיסטיקה. אם נוסיף כלי שיווק, הוא יפעל רק אחרי שתאשרו אותו, נעדכן את העמוד הזה ונשאל אתכם מחדש."
              : "אם נוסיף כלי סטטיסטיקה שמשתמש בעוגיות, או כלי שיווק, הוא יפעל רק אחרי שתאשרו אותו, נעדכן את העמוד הזה ונשאל אתכם מחדש."}
        </p>
      </LegalSection>

      <LegalSection {...SEC.notUsed}>
        {/* components/share-link.tsx and whatsapp-cta.tsx are plain wa.me links: nothing loads
            from WhatsApp until one is followed. */}
        <p>
          {marketing
            ? `אין באתר תוספים שנטענים מרשתות חברתיות או סקריפטים של צד שלישי, מלבד ${analytics ? "Google Analytics, שנטען מהשרתים של Google בכל עמוד באתר (חוץ מעמודי הניהול) ושומר עוגיות רק אחרי שאישרתם עוגיות סטטיסטיקה, ו־" : ""}Meta Pixel, שנטען מהשרתים של Meta רק אחרי שאישרתם עוגיות שיווק. אין באתר פיקסלים של רשתות פרסום אחרות.`
            : analytics
              ? "אין באתר פיקסלים של רשתות פרסום, תוספים שנטענים מרשתות חברתיות או סקריפטים של צד שלישי, מלבד Google Analytics, שנטען מהשרתים של Google בכל עמוד באתר (חוץ מעמודי הניהול) ושומר עוגיות רק אחרי שאישרתם עוגיות סטטיסטיקה."
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
          מוצר נטען מאלי אקספרס: כשנפתח עמוד של מוצר שיש לו סרטון, הסרטון נטען ומתחיל לפעול בלי קול
          (אם ביקשתם במכשיר להפחית תנועה או לחסוך בנתונים, רק כשתפעילו אותו). אלי אקספרס שומרת
          עוגיות משלה בדומיין שלה, בין השאר כדי לשייך קנייה לקישור השותפים שלנו, לפי מדיניות העוגיות
          והפרטיות שלה. אין לנו גישה לעוגיות האלה ואין לנו שליטה עליהן. כך גם וואטסאפ, אם תפתחו אותו
          בכפתור שיתוף.
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
            ביטול ההסכמה לסטטיסטיקה מוחק מיד את עוגיות{" "}
            <bdi dir="ltr" className="font-mono">
              _ga
            </bdi>{" "}
            מהדפדפן, ומאותו רגע Google Analytics חוזר לשלוח נתוני שימוש בלי עוגיות ובלי מזהה קבוע.
            את השליחה הזו אפשר למנוע רק בדפדפן עצמו: בהגנה מפני מעקב שלו, או בתוסף שחוסם כלי מדידה.
          </p>
        )}
        {marketing && (
          <p>
            ביטול ההסכמה לשיווק עוצר מיד את Meta Pixel ומוחק מהדפדפן את העוגיות <Code>_fbp</Code> ו־
            <Code>_fbc</Code>. מה שכבר נשלח ל־Meta נשמר אצלה לפי המדיניות שלה. את העוגיות של Meta
            בדומיין שלה אפשר למחוק בהגדרות הדפדפן, ואת השימוש שלה בנתונים לפרסום אפשר להגביל בהגדרות
            המודעות בחשבון פייסבוק או אינסטגרם.
          </p>
        )}
        <CookieSettingsButton className={`${btnSecondary} ${btnMd} print:hidden`} />
        <p>
          אפשר גם למחוק עוגיות ונתוני אתרים בהגדרות הדפדפן. אחרי מחיקה נשאל שוב על העוגיות, ערכת
          הצבעים תחזור להיות לפי הגדרות המכשיר, ו״החיפושים שלי״ יתרוקנו. את ״החיפושים שלי״ אפשר
          לנקות גם בלי זה: בכפתור ה־× של חיפוש, או בכפתור ״ניקוי״ שלידם בעמוד הבית ובעמוד החיפושים
          האחרונים.
        </p>
      </LegalSection>
    </StaticPage>
  );
}
