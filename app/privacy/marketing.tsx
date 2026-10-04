// The /privacy text about the Meta Pixel. Shown only while the owner has set a pixel id
// (/admin/settings, "חיבור ל־Meta"); without one the page says what it said before. Every
// statement must stay true of components/analytics/fbq.ts and meta-pixel.tsx (strict: only inside
// ConsentGate "marketing"; page views only for addresses without visitor text, metaPageAllowed;
// the referrer reduced; autoConfig off, no advanced matching; revoke and cookie deletion), of
// app/go/[productId]/respond.ts (the buy-click event with the product id only) and of
// lib/consent/categories.ts (marketingStorage).
import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/config/legal";

/** Meta's privacy policy. */
export const META_PRIVACY_POLICY_URL = "https://www.facebook.com/privacy/policy";
/** Where a Facebook or Instagram user sets how Meta uses data for ads. */
export const META_AD_PREFERENCES_URL = "https://www.facebook.com/adpreferences";

function Code({ children }: { children: string }) {
  return (
    <bdi dir="ltr" className="font-mono">
      {children}
    </bdi>
  );
}

function MetaLinks() {
  return (
    <>
      <a href={META_PRIVACY_POLICY_URL} rel="noopener noreferrer">
        מדיניות הפרטיות של Meta
      </a>
      , ו
      <a href={META_AD_PREFERENCES_URL} rel="noopener noreferrer">
        הגדרות המודעות בחשבון Meta
      </a>
    </>
  );
}

/** The summary's sentence about measuring and advertising tools, while the pixel is set. */
export function MarketingSummary({ analytics }: { analytics: boolean }) {
  return analytics
    ? "את השימוש באתר אנחנו מודדים בכלי של ספק האחסון, בלי עוגיות, וב־Google Analytics, שבלי אישור פועל בלי עוגיות ובלי מזהה קבוע ושומר את העוגיות שלו רק אם אישרתם אותן בהגדרות העוגיות. כלי הפרסום של Meta (Meta Pixel, לפייסבוק ולאינסטגרם) פועל רק אם אישרתם עוגיות שיווק, ובלי אישור לא נשלח ל־Meta דבר."
    : "את הביקורים באתר אנחנו סופרים בלי עוגיות ובלי לזהות אתכם. כלי הפרסום של Meta (Meta Pixel, לפייסבוק ולאינסטגרם) פועל רק אם אישרתם עוגיות שיווק, ובלי אישור לא נשלח ל־Meta דבר.";
}

/** #tracking: the Meta Pixel, after the analytics text. */
export function MarketingTracking({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <>
      <h3>Meta Pixel: מדידה ופרסום בפייסבוק ובאינסטגרם, רק באישור</h3>
      <p>
        כדי לדעת אם המודעות שלנו בפייסבוק ובאינסטגרם מביאות מבקרים, ולהציג אותן לקהלים מתאימים (למשל
        למי שכבר ביקר באתר), אנחנו משתמשים ב־Meta Pixel של Meta Platforms. הסקריפט שלו נטען מהשרתים
        של Meta רק אם אישרתם עוגיות שיווק בהודעת העוגיות או ב״הגדרות עוגיות״. בלי אישור הוא לא נטען
        בכלל, ולא נשלח ל־Meta דבר.
      </p>
      <h3>מה נשלח ל־Meta אחרי שאישרתם עוגיות שיווק</h3>
      <ul>
        <li>
          צפייה בעמוד, בכל מעבר עמוד: כתובת העמוד והעמוד שממנו הגעתם. עמוד שבכתובת שלו יש טקסט חיפוש
          או טקסט אחר שכתבתם (כמו עמוד תוצאות החיפוש) לא נשלח בכלל, ועמוד שהגעתם ממנו נשלח בלי
          הפרמטרים שלו אם יש בהם טקסט כזה. עמודי הניהול לא נשלחים.
        </li>
        <li>
          לחיצה על כפתור קנייה שמעביר לאלי אקספרס: אירוע של התחלת קנייה עם מזהה המוצר בלבד. הוא נשלח
          מעמוד מעבר קצר באתר, שהכתובת שלו לא כוללת את טקסט החיפוש, ובלי הכתובת של העמוד שממנו
          לחצתם.
        </li>
        <li>
          מידע טכני שהדפדפן שולח בכל פנייה ל־Meta: כתובת ה־IP, סוג הדפדפן והמכשיר, מערכת ההפעלה, שפה
          וגודל המסך.
        </li>
        <li>
          המזהה האקראי של הדפדפן מהעוגייה <Code>_fbp</Code>, ואם הגעתם מלחיצה על מודעה או קישור
          בפייסבוק או באינסטגרם, גם מזהה הלחיצה מהעוגייה <Code>_fbc</Code>. הפירוט ב
          <Link href={LEGAL_PATHS.cookies}>מדיניות העוגיות</Link>.
        </li>
        <li>
          אם אתם מחוברים לפייסבוק או לאינסטגרם באותו דפדפן, הדפדפן שולח ל־Meta גם את העוגיות שלה,
          ו־Meta עשויה לקשר את הביקור לחשבון שלכם.
        </li>
      </ul>
      <h3>מה לא נשלח ל־Meta</h3>
      <ul>
        <li>
          אנחנו לא שולחים ל־Meta שם, אימייל, טלפון או את טקסט החיפוש. לא הפעלנו את ההתאמה המתקדמת של
          Meta (advanced matching), וכיבינו את איסוף האירועים האוטומטי של הפיקסל (לחיצות ופרטי עמוד
          שהוא אוסף בעצמו).
        </li>
      </ul>
      <h3>ביטול ההסכמה לשיווק</h3>
      <p>
        אפשר לסרב, או לבטל את ההסכמה בכל רגע ב״הגדרות עוגיות״ בתחתית כל עמוד: הפיקסל מפסיק לשלוח
        מיד, והעוגיות <Code>_fbp</Code> ו־<Code>_fbc</Code> נמחקות מהדפדפן. מה שכבר נשלח ל־Meta נשמר
        אצלה ומשמש לפי המדיניות שלה. עוד על המידע ש־Meta מקבלת ועל הבחירות שלכם אצלה: <MetaLinks />.
      </p>
    </>
  );
}

/** #basis: the legal basis of the Meta Pixel. */
export function MarketingBasisItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <li>
      את Meta Pixel אנחנו מפעילים רק על סמך ההסכמה שלכם לעוגיות שיווק, למטרות מדידה של מודעות ובניית
      קהלים לפרסום. אפשר לבטל את ההסכמה בכל עת, והביטול לא פוגע בשימוש באתר.
    </li>
  );
}

/** #retention: how long Meta keeps what it received, and the cookies. */
export function MarketingRetentionItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <li>
      המידע שנשלח ל־Meta דרך הפיקסל: אצל Meta, לפי המדיניות שלה. העוגיות שלו בדפדפן, רק אם אישרתם
      עוגיות שיווק: עד 90 יום מהביקור האחרון, או עד שתבטלו את ההסכמה.
    </li>
  );
}

/** #sharing: Meta as a separate controller. */
export function MarketingSharingItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <li>
      Meta Platforms (פייסבוק ואינסטגרם), שירות Meta Pixel: רק ממי שאישר עוגיות שיווק, מקבלת ישירות
      מהדפדפן את המידע שמפורט בסעיף ״עוגיות וכלי מעקב״. Meta היא אחראית נפרדת למידע הזה, לא רק ספקית
      שלנו: היא משתמשת בו גם למטרות שלה, כמו מדידה ושיפור של שירותי הפרסום שלה, לפי מדיניות הפרטיות
      שלה, ועשויה להעביר אותו אל מחוץ לישראל ולאיחוד האירופי, למשל לארצות הברית.
    </li>
  );
}

/** #rights: withdrawal, and Meta's own records. */
export function MarketingRights({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <p>
      את ההסכמה לעוגיות שיווק אפשר לבטל בכל רגע ב״הגדרות עוגיות״ בתחתית כל עמוד. על מידע שכבר נשלח
      ל־Meta, אפשר לפנות ל־Meta עצמה, שהיא האחראית עליו: <MetaLinks />.
    </p>
  );
}
