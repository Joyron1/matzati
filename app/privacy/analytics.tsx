// The /privacy text about Google Analytics. Shown only while the owner has set a measurement id
// (/admin/settings); without one the page says what it said before. Every statement must stay
// true of components/analytics/gtag.ts (what is sent, Consent Mode, the reduced address, the
// cookies and their deletion) and of the consent flow (ConsentGate, ANALYTICS_NOTICE).
import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/config/legal";

/** The summary's sentence about analytics and tracking tools. */
export function AnalyticsSummary({ inUse }: { inUse: boolean }) {
  return inUse
    ? "אנחנו לא משתמשים בכלי פרסום או מעקב, וכלי הסטטיסטיקה (Google Analytics) פועל רק אם אישרתם אותו בהגדרות העוגיות."
    : "אנחנו לא משתמשים בכלי אנליטיקה, פרסום או מעקב.";
}

/** #basis: the legal basis of Google Analytics. */
export function AnalyticsBasisItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return <li>את Google Analytics אנחנו מפעילים רק על סמך ההסכמה שלכם, ואפשר לבטל אותה בכל עת.</li>;
}

/** #retention: how long Google keeps what it received. */
export function AnalyticsRetentionItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <li>
      נתוני Google Analytics: אצל Google, לפי הגדרת שמירת הנתונים בחשבון Google Analytics שלנו
      (חודשיים או 14 חודשים). העוגיות שלו בדפדפן: עד שנתיים מהביקור האחרון, או עד שתבטלו את ההסכמה.
    </li>
  );
}

/** #sharing: Google as a provider. */
export function AnalyticsSharingItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <li>
      Google (ארצות הברית), שירות Google Analytics: רק אם אישרתם עוגיות סטטיסטיקה. מקבלת את נתוני
      השימוש שמפורטים בסעיף ״עוגיות וכלי מעקב״, ישירות מהדפדפן שלכם.
    </li>
  );
}

/** #tracking: the whole section's text. */
export function AnalyticsTracking({ inUse }: { inUse: boolean }) {
  if (!inUse) {
    return (
      <>
        <p>
          האתר לא משתמש היום בכלי אנליטיקה, בפיקסלים או בעוגיות פרסום, ולא טוען סקריפטים של צד
          שלישי. הגופנים ותמונות המוצרים מוגשים מהשרתים של האתר. בדפדפן נשמרים רק דברים שהאתר צריך
          כדי לעבוד ולזכור בחירות שעשיתם, והפירוט המלא ב
          <Link href={LEGAL_PATHS.cookies}>מדיניות העוגיות</Link>.
        </p>
        <p>
          אם נוסיף בעתיד כלי אנליטיקה או פרסום, הוא יפעל רק אחרי שתאשרו אותו בהגדרות העוגיות, ונעדכן
          את המדיניות לפני כן.
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        כדי להבין איך משתמשים באתר, אנחנו משתמשים ב־Google Analytics 4 של Google. הוא פועל רק אם
        אישרתם עוגיות סטטיסטיקה בהגדרות העוגיות. בלי אישור הסקריפט שלו לא נטען, ושום דבר לא נשלח
        ל־Google. אין באתר פיקסלים או עוגיות פרסום, והגופנים ותמונות המוצרים מוגשים מהשרתים של האתר.
      </p>
      <h3>מה נשלח ל־Google</h3>
      <ul>
        <li>
          העמודים שביקרתם בהם: הכתובת בלי טקסט החיפוש ובלי פרמטרים אחרים שכתבתם, שם העמוד (בעמוד
          תוצאות החיפוש, בלי מה שחיפשתם) והעמוד שממנו הגעתם.
        </li>
        <li>
          מידע טכני שהדפדפן שולח: סוג הדפדפן והמכשיר, מערכת ההפעלה, גודל המסך, שפה, ומיקום משוער
          (מדינה ועיר) ש־Google מסיקה מכתובת ה־IP.
        </li>
        <li>
          מזהה אקראי של הדפדפן שנשמר בעוגייה, כדי להבחין בין מבקרים חדשים לחוזרים, ואירועים שהכלי
          אוסף בעצמו לפי ההגדרות שלו, כמו גלילה בעמוד.
        </li>
      </ul>
      <h3>מה עשינו כדי לצמצם</h3>
      <ul>
        <li>
          אנונימיזציה של כתובת ה־IP. הכלי משתמש בה רק כדי להעריך מיקום, ולפי Google לא שומר אותה.
          ביקשנו ממנו זאת גם במפורש.
        </li>
        <li>
          כיבינו את Google Signals ואת ההתאמה האישית של מודעות, ובמצב ההסכמה של Google (Consent
          Mode) כל הרשאות הפרסום נשארות חסומות. רק מדידת הסטטיסטיקה מופעלת, ורק אחרי האישור שלכם.
        </li>
        <li>אנחנו לא שולחים ל־Google שם, אימייל, טלפון או את טקסט החיפוש.</li>
      </ul>
      <h3>ביטול</h3>
      <p>
        אפשר לבטל את ההסכמה בכל רגע ב״הגדרות עוגיות״ בתחתית כל עמוד: השליחה ל־Google נעצרת מיד,
        והעוגיות של Google Analytics נמחקות מהדפדפן. הפירוט המלא של העוגיות ב
        <Link href={LEGAL_PATHS.cookies}>מדיניות העוגיות</Link>.
      </p>
    </>
  );
}
