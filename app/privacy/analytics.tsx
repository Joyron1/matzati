// The /privacy text about Google Analytics. Shown only while the owner has set a measurement id
// (/admin/settings); without one the page says what it said before. Every statement must stay
// true of components/analytics/gtag.ts (what is sent, Consent Mode "advanced": cookieless pings for
// everyone, the cookies only after consent; the reduced address, the cookies and their deletion)
// and of the consent flow (components/analytics/google-analytics.tsx, consentNotice). While the
// Meta Pixel is configured too (`marketingInUse`), the sentences that say the site has no
// advertising tools give way to ./marketing.tsx.
import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/config/legal";

/** The summary's sentence about analytics and tracking tools. */
export function AnalyticsSummary({ inUse }: { inUse: boolean }) {
  return inUse
    ? "אנחנו לא משתמשים בכלי פרסום. את השימוש באתר אנחנו מודדים בכלי של ספק האחסון, בלי עוגיות, וב־Google Analytics, שבלי אישור פועל בלי עוגיות ובלי מזהה קבוע ושומר את העוגיות שלו רק אם אישרתם אותן בהגדרות העוגיות."
    : "אנחנו לא משתמשים בכלי פרסום או מעקב, ואת הביקורים באתר אנחנו סופרים בלי עוגיות ובלי לזהות אתכם.";
}

/** #tracking: Vercel Web Analytics, always on. True of components/analytics/vercel-analytics.tsx. */
function VercelCounting() {
  return (
    <>
      <h3>ספירת ביקורים בלי עוגיות</h3>
      <p>
        כדי לדעת כמה מבקרים יש באתר ובאילו עמודים, אנחנו משתמשים ב־Vercel Web Analytics, כלי המדידה
        של ספק האחסון. הסקריפט שלו נטען מהדומיין של האתר, והוא לא שומר בדפדפן עוגיות או מידע אחר,
        ולכן הוא פועל בלי לבקש הסכמה.
      </p>
      <ul>
        <li>
          בכל מעבר עמוד נשלחים ל־Vercel: כתובת העמוד בלי טקסט החיפוש ובלי שאר הפרמטרים, העמוד שממנו
          הגעתם כפי שהדפדפן מוסר אותו (אצל מי שאישר עוגיות שיווק, בלי טקסט החיפוש), סוג הדפדפן,
          מערכת ההפעלה וסוג המכשיר, ומדינה ש־Vercel מסיקה מכתובת ה־IP.
        </li>
        <li>
          כדי להבחין בין מבקרים, Vercel מחשבת מכתובת ה־IP ומפרטי הדפדפן ערך מגובב שמתחלף כל יום. לפי
          Vercel, היא לא שומרת את כתובת ה־IP ולא מזהה מבקר מיום ליום.
        </li>
        <li>עמודי הניהול לא נמדדים.</li>
      </ul>
    </>
  );
}

/** #basis: the legal basis of Google Analytics. */
export function AnalyticsBasisItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <>
      <li>
        את המדידה ב־Google Analytics בלי עוגיות אנחנו מפעילים בלי לבקש הסכמה, על סמך האינטרס שלנו
        לתפעל את האתר ולשפר אותו: היא לא שומרת דבר בדפדפן שלכם ולא מזהה אתכם מביקור לביקור.
      </li>
      <li>
        את העוגיות של Google Analytics אנחנו שומרים רק על סמך ההסכמה שלכם, ואפשר לבטל אותה בכל עת.
      </li>
    </>
  );
}

/** #retention: how long Google keeps what it received. */
export function AnalyticsRetentionItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <li>
      נתוני Google Analytics: אצל Google, לפי הגדרת שמירת הנתונים בחשבון Google Analytics שלנו
      (חודשיים או 14 חודשים). העוגיות שלו בדפדפן, רק אם אישרתם אותן: עד שנתיים מהביקור האחרון, או עד
      שתבטלו את ההסכמה.
    </li>
  );
}

/** #sharing: Google as a provider. */
export function AnalyticsSharingItem({ inUse }: { inUse: boolean }) {
  if (!inUse) return null;
  return (
    <li>
      Google (ארצות הברית), שירות Google Analytics: מקבלת ישירות מהדפדפן שלכם את נתוני השימוש
      שמפורטים בסעיף ״עוגיות וכלי מעקב״, מכל המבקרים בלי עוגיות ובלי מזהה קבוע, ועם עוגיות
      הסטטיסטיקה שלו רק ממי שאישר אותן.
    </li>
  );
}

/**
 * #tracking: the whole section's text about measuring (./marketing.tsx's MarketingTracking follows
 * it while the Meta Pixel is configured, `marketingInUse`).
 */
export function AnalyticsTracking({
  inUse,
  marketingInUse,
}: {
  inUse: boolean;
  marketingInUse: boolean;
}) {
  if (!inUse && marketingInUse) {
    return (
      <>
        <p>
          האתר לא משתמש היום בכלי מדידה שמשתמש בעוגיות. כלי הפרסום היחיד באתר הוא Meta Pixel, שנטען
          רק אחרי שאישרתם עוגיות שיווק (בהמשך הסעיף). הגופנים מוגשים מהשרתים של האתר; תמונות המוצרים
          נטענות ישירות משרתי התמונות של אלי אקספרס (ראו ״עם מי המידע משותף״). הפירוט המלא של מה
          שנשמר בדפדפן ב<Link href={LEGAL_PATHS.cookies}>מדיניות העוגיות</Link>.
        </p>
        <VercelCounting />
        <p>
          אם נוסיף בעתיד כלי מדידה שמשתמש בעוגיות, או כלי פרסום אחר, הוא יפעל רק אחרי שתאשרו אותו
          בהגדרות העוגיות, ונעדכן את המדיניות לפני כן.
        </p>
      </>
    );
  }
  if (!inUse) {
    return (
      <>
        <p>
          האתר לא משתמש היום בפיקסלים, בעוגיות פרסום או בכלי מדידה שמשתמש בעוגיות, ולא טוען סקריפטים
          מאתרים אחרים. הגופנים מוגשים מהשרתים של האתר; תמונות המוצרים נטענות ישירות משרתי התמונות
          של אלי אקספרס (ראו ״עם מי המידע משותף״). בדפדפן נשמרים רק דברים שהאתר צריך כדי לעבוד
          ולזכור בחירות שעשיתם, והפירוט המלא ב
          <Link href={LEGAL_PATHS.cookies}>מדיניות העוגיות</Link>.
        </p>
        <VercelCounting />
        <p>
          אם נוסיף בעתיד כלי מדידה שמשתמש בעוגיות, או כלי פרסום, הוא יפעל רק אחרי שתאשרו אותו
          בהגדרות העוגיות, ונעדכן את המדיניות לפני כן.
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        כדי להבין איך משתמשים באתר, אנחנו משתמשים ב־Google Analytics 4 של Google, במצב ההסכמה המתקדם
        של Google (Consent Mode). הסקריפט שלו נטען מהשרתים של Google בכל עמוד באתר, חוץ מעמודי
        הניהול, ושולח ל־Google נתוני שימוש גם לפני שבחרתם בהודעת העוגיות. בלי אישור הוא לא קורא ולא
        שומר עוגיות; את העוגיות שלו הוא שומר רק אם אישרתם עוגיות סטטיסטיקה.{" "}
        {marketingInUse
          ? "כלי הפרסום היחיד באתר הוא Meta Pixel, שנטען רק אחרי שאישרתם עוגיות שיווק (בהמשך הסעיף)."
          : "אין באתר פיקסלים או עוגיות פרסום."}{" "}
        הגופנים מוגשים מהשרתים של האתר; תמונות המוצרים נטענות ישירות משרתי התמונות של אלי אקספרס
        (ראו ״עם מי המידע משותף״).
      </p>
      <VercelCounting />
      <h3>מה נשלח ל־Google, גם בלי אישור</h3>
      <ul>
        <li>
          בכל מעבר עמוד: כתובת העמוד בלי טקסט החיפוש ובלי פרמטרים אחרים שכתבתם, שם העמוד (בעמוד
          תוצאות החיפוש, בלי מה שחיפשתם) והעמוד שממנו הגעתם (מאתר אחר, הכתובת שהדפדפן מוסר בלי
          הפרמטרים שלה; מעמוד באתר שלנו, באותו צמצום).
        </li>
        <li>
          מידע טכני שהדפדפן שולח: סוג הדפדפן והמכשיר, מערכת ההפעלה, גודל המסך, שפה, ומיקום משוער
          (מדינה ועיר) ש־Google מסיקה מכתובת ה־IP.
        </li>
        <li>אירועים שהכלי אוסף בעצמו לפי ההגדרות שלו, כמו גלילה בעמוד.</li>
        <li>
          בלי אישור, כל זה נשלח בלי עוגיות ובלי מזהה שנשמר בדפדפן, ולכן Google לא יכולה לזהות את
          הדפדפן שלכם מביקור לביקור. Google עשויה להשלים את מה שחסר בהערכה סטטיסטית (מודלים), לפי
          המבקרים שאישרו, ואנחנו רואים את התוצאה רק כמספרים מצטברים בדוחות.
        </li>
      </ul>
      <h3>מה נוסף אם אישרתם עוגיות סטטיסטיקה</h3>
      <ul>
        <li>
          אותם נתונים, ובנוסף עוגיות של Google Analytics בדפדפן עם מזהה אקראי של הדפדפן, כדי להבחין
          בין מבקרים חדשים לחוזרים ולמדוד ביקורים ומשכם. הפירוט ב
          <Link href={LEGAL_PATHS.cookies}>מדיניות העוגיות</Link>.
        </li>
      </ul>
      <h3>מה עשינו כדי לצמצם</h3>
      <ul>
        <li>
          אנונימיזציה של כתובת ה־IP. הכלי משתמש בה רק כדי להעריך מיקום, ולפי Google לא שומר אותה.
          ביקשנו ממנו זאת גם במפורש.
        </li>
        <li>
          כיבינו את Google Signals ואת ההתאמה האישית של מודעות, ובמצב ההסכמה של Google כל הרשאות
          הפרסום חסומות תמיד, גם אחרי אישור. האישור שלכם מפעיל רק את עוגיות הסטטיסטיקה.
        </li>
        <li>אנחנו לא שולחים ל־Google שם, אימייל, טלפון או את טקסט החיפוש.</li>
        <li>עמודי הניהול לא נמדדים.</li>
      </ul>
      <h3>סירוב וביטול</h3>
      <p>
        אפשר לסרב לעוגיות הסטטיסטיקה, או לבטל את ההסכמה בכל רגע ב״הגדרות עוגיות״ בתחתית כל עמוד:
        העוגיות של Google Analytics נמחקות מהדפדפן, ומאותו רגע נשלחים ל־Google רק נתוני השימוש בלי
        עוגיות שמתוארים למעלה. את השליחה הזו אי אפשר לכבות באתר עצמו. אפשר למנוע אותה בדפדפן: בהגנה
        מפני מעקב שלו, או בתוסף שחוסם כלי מדידה, כמו התוסף של Google לביטול Google Analytics. הפירוט
        המלא של העוגיות ב<Link href={LEGAL_PATHS.cookies}>מדיניות העוגיות</Link>.
      </p>
    </>
  );
}
