import type { Metadata } from "next";
import Link from "next/link";
import {
  EmailLink,
  LegalSection,
  StaticPage,
  ToFill,
  type PageSection,
} from "@/components/static-page";
import { BRAND } from "@/lib/config/brand";
import {
  ACCESSIBILITY_CHECKED_AT,
  LEGAL,
  LEGAL_PATHS,
  accessibilityEmail,
  formatLegalDate,
} from "@/lib/config/legal";
import { pageMetadata } from "@/lib/seo/page-meta";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "הצהרת נגישות",
    description: `מה עשינו כדי שהאתר ״${BRAND.name}״ יהיה נגיש, איך משתמשים בו במקלדת, מגבלות ידועות ופרטי רכז הנגישות.`,
    path: "/accessibility",
  }),
};

// Written per regulation 35 of the Equal Rights for Persons with Disabilities (Service
// Accessibility) Regulations, 2013. Every item must stay true of the code: app/layout.tsx (lang,
// dir, skip link), app/globals.css (focus ring, reduced motion), components/theme-toggle.tsx,
// components/focus-scroll-list.tsx (a focused card or pill in a sideways row scrolls into view),
// components/offers-nav.tsx (Escape), components/cookie-consent/ (native dialog), the new-tab
// notes on external links, components/search-wait/results-announcer.tsx, components/product-image.tsx
// (alt = product title), components/product-video.tsx (no captions), lib/hot/copy.ts.
const SEC = {
  status: { id: "status", title: "רמת הנגישות" },
  done: { id: "done", title: "מה עשינו" },
  keyboard: { id: "keyboard", title: "שימוש במקלדת ובהגדרות תצוגה" },
  limitations: { id: "limitations", title: "מגבלות ידועות" },
  contact: { id: "contact", title: "פניות בנושא נגישות" },
} as const satisfies Record<string, PageSection>;

function CoordinatorPhone() {
  const phone = LEGAL.accessibilityCoordinatorPhone.trim();
  if (!phone) return <ToFill>מספר טלפון יעודכן בקרוב</ToFill>;
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
      <bdi dir="ltr">{phone}</bdi>
    </a>
  );
}

function CoordinatorName() {
  const name = LEGAL.accessibilityCoordinatorName.trim();
  return name ? <>{name}</> : <ToFill>שם רכז הנגישות יעודכן בקרוב</ToFill>;
}

const KEYS: { keys: string; action: string }[] = [
  { keys: "Tab", action: "מעבר לקישור, לכפתור או לשדה הבא" },
  { keys: "Shift+Tab", action: "חזרה לקודם" },
  { keys: "Enter", action: "הפעלת קישור או כפתור, ושליחת חיפוש" },
  { keys: "Space", action: "הפעלת כפתור, ופתיחה וסגירה של שאלה בשאלות הנפוצות" },
  { keys: "Esc", action: "סגירת תפריט או חלון שנפתח" },
];

export default function AccessibilityPage() {
  return (
    <StaticPage
      page="accessibility"
      sections={Object.values(SEC)}
      intro={
        <p>
          אנחנו רוצים שכל אחד ואחת יוכלו להשתמש באתר ״{BRAND.name}״, גם אנשים עם מוגבלות. ההצהרה
          נכתבה לפי תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג־2013.
        </p>
      }
    >
      <LegalSection {...SEC.status}>
        <p>
          פעלנו להתאים את האתר לתקן הישראלי ת״י 5568, שמבוסס על הנחיות הנגישות לתוכן אינטרנט WCAG
          2.0 של ארגון W3C, ברמה AA. האתר בנוי לעבוד בדפדפנים עדכניים, במחשב ובטלפון.
        </p>
        {/* ACCESSIBILITY_CHECKED_AT: what was checked that day, and only that. 2026-09-28: a
            keyboard-only audit of 20 pages at 390 and 1440 px (home, hot, recent searches,
            coupons, sales, deals, product, the legal pages, 404, admin sign-in and the dev
            previews of the results; Tab order, focus ring, traps, Enter / Space / Esc), the color
            tokens' contrast in both themes (5.16:1 at least) and automated checks (Lighthouse,
            axe). No screen-reader pass and no 200% zoom pass yet: add them to this line only once
            done. */}
        <p>
          בדיקת הנגישות האחרונה:{" "}
          <time dateTime={ACCESSIBILITY_CHECKED_AT}>
            {formatLegalDate(ACCESSIBILITY_CHECKED_AT)}
          </time>
          . נבדקו ניווט ושימוש במקלדת בלבד בעמודים המרכזיים של האתר, בטלפון ובמחשב, סימון המיקוד,
          ניגודיות הצבעים בשני המצבים, ובדיקות אוטומטיות של כללי הנגישות.
        </p>
      </LegalSection>

      <LegalSection {...SEC.done}>
        <ul>
          <li>
            האתר מוגדר כאתר בעברית, מימין לשמאל, כדי שקוראי מסך יקראו אותו נכון. שמות מוצרים באנגלית
            מוצגים בכיוון הנכון שלהם.
          </li>
          <li>
            לכל עמוד מבנה ברור: כותרות לפי הסדר, ואזורים מסומנים לכותרת העליונה, לתפריטים, לתוכן
            ולתחתית העמוד.
          </li>
          <li>בתחילת כל עמוד יש קישור ״דלגו לתוכן״, שמופיע במעבר הראשון במקש Tab.</li>
          <li>
            כל הפעולות באתר אפשריות במקלדת בלבד, בסדר מעבר הגיוני, עם מסגרת בולטת סביב הרכיב שעליו
            נמצאים.
          </li>
          <li>כפתורים וקישורים בגודל נוח ללחיצה, גם בטלפון.</li>
          <li>הצבעים נבחרו כך שהטקסט ניגודי לרקע ביחס של 4.5:1 לפחות, במצב בהיר ובמצב כהה.</li>
          <li>
            אפשר לבחור מצב בהיר או כהה בכפתור שבראש כל עמוד. בלי בחירה, האתר מוצג לפי הגדרות המכשיר.
          </li>
          <li>
            כשבמכשיר מוגדרת הפחתת תנועה, האתר מבטל אנימציות ומעברים. רשימות המוצרים הנגללות לא זזות
            מעצמן.
          </li>
          {/* components/hot-products-scroller.tsx (AUTO_ADVANCE_MS, RESUME_AFTER_MS): keep this
              true of it. */}
          <li>
            רשימת המוצרים החמים בדף הבית עוברת מעצמה לקבוצת המוצרים הבאה כל 3 שניות, ואחרי האחרונה
            חוזרת להתחלה. היא נעצרת כשהעכבר מעליה, כשנוגעים בה, כשגוללים בה וכשמגיעים אליה במקלדת,
            וממשיכה 5 שניות אחרי שעוזבים אותה. כפתור ההשהיה שליד הכותרת שלה עוצר אותה עד שלוחצים
            עליו שוב.
          </li>
          {/* components/product-gallery.tsx and product-video.tsx (mayAutoplayVideo): keep it true. */}
          <li>
            בעמוד מוצר שיש לו סרטון, הסרטון מתחיל לפעול מעצמו, בלי קול ובלולאה. בכפתורי הנגן שלו
            אפשר לעצור אותו ולהפעיל את הקול. כשבמכשיר מוגדרת הפחתת תנועה הוא לא מתחיל מעצמו.
          </li>
          <li>האתר לא חוסם הגדלה של התצוגה, ומתאים את עצמו לרוחב המסך.</li>
          <li>
            לתמונות המוצרים יש טקסט חלופי (שם המוצר), חוץ מתמונה ששם המוצר כתוב ממש לידה, שמסומנת
            כקישוט כדי שלא יוקרא פעמיים. גם סמלים שנועדו לקישוט מוסתרים מקוראי מסך.
          </li>
          <li>
            לכפתורים שמוצג בהם רק סמל יש שם שקוראי מסך מקריאים, וקישורים שנפתחים בכרטיסייה חדשה
            מודיעים על כך.
          </li>
          <li>
            לשדות יש תוויות, ותוצאות החיפוש מוקראות לקוראי מסך כשהן מופיעות. השאלות הנפוצות בנויות
            מרכיבים מובנים של הדפדפן.
          </li>
        </ul>
      </LegalSection>

      <LegalSection {...SEC.keyboard}>
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[8rem_1fr]">
          {KEYS.map(({ keys, action }) => (
            <div key={keys} className="contents">
              <dt>
                <kbd
                  dir="ltr"
                  className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-sm"
                >
                  {keys}
                </kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <ul>
          <li>
            הגדלת התצוגה: Ctrl ופלוס (+). הקטנה: Ctrl ומינוס (-). חזרה לגודל הרגיל: Ctrl ו־0. ב־Mac
            משתמשים ב־Command במקום Ctrl.
          </li>
          <li>
            ברשימות שנגללות הצידה, כמו המוצרים החמים בעמוד הבית, המעבר ב־Tab מגיע לכל מוצר וגולל
            אותו לתצוגה.
          </li>
        </ul>
      </LegalSection>

      <LegalSection {...SEC.limitations}>
        <p>למרות המאמצים, יש חלקים שעדיין לא נגישים במלואם:</p>
        <ul>
          <li>
            הקנייה, הביקורות ועמודי המוצרים המלאים נמצאים באתר של אלי אקספרס. הוא לא בשליטתנו,
            ונגישותו באחריותה.
          </li>
          <li>
            תמונות המוצרים מגיעות מהמוכרים. הטקסט החלופי שלהן הוא שם המוצר, והוא לא מתאר מה רואים
            בתמונה.
          </li>
          <li>סרטוני המוצרים של אלי אקספרס מוצגים כפי שהם, בלי כתוביות ובלי תיאור קולי.</li>
          <li>
            שמות המוצרים ברשימת המוצרים החמים הם תרגום אוטומטי של אלי אקספרס, ולכן לפעמים לא ברורים.
          </li>
          <li>שמות של חלק מהמוצרים מוצגים באנגלית, כפי שהם באלי אקספרס.</li>
        </ul>
      </LegalSection>

      <LegalSection {...SEC.contact}>
        <p>
          נתקלתם בבעיית נגישות, או שמשהו באתר לא עובד לכם? נשמח לשמוע ולתקן. כדאי לציין באיזה עמוד,
          מה ניסיתם לעשות, ובאיזה דפדפן, מכשיר או טכנולוגיה מסייעת השתמשתם.
        </p>
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[8rem_1fr]">
          <div className="contents">
            <dt className="font-semibold text-muted">רכז הנגישות</dt>
            <dd>
              <CoordinatorName />
            </dd>
          </div>
          <div className="contents">
            <dt className="font-semibold text-muted">טלפון</dt>
            <dd>
              <CoordinatorPhone />
            </dd>
          </div>
          <div className="contents">
            <dt className="font-semibold text-muted">אימייל</dt>
            <dd className="[&_a]:font-semibold [&_a]:text-accent-ink [&_a]:underline [&_a]:underline-offset-4">
              <EmailLink email={accessibilityEmail()} />
            </dd>
          </div>
        </dl>
        <p>
          עוד מידע באתר: <Link href={LEGAL_PATHS.terms}>התקנון</Link> ו
          <Link href={LEGAL_PATHS.privacy}>מדיניות הפרטיות</Link>.
        </p>
      </LegalSection>
    </StaticPage>
  );
}
