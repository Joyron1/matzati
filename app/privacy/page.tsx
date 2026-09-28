import type { Metadata } from "next";
import Link from "next/link";
import {
  ContactEmail,
  LegalSection,
  OperatorName,
  StaticPage,
  type PageSection,
} from "@/components/static-page";
import { ADMIN_LOGINS_PER_HOUR } from "@/lib/admin/login-rate";
import { BRAND } from "@/lib/config/brand";
import { RETENTION } from "@/lib/config/legal";
import { SEARCHES_PER_DAY, SEARCHES_PER_HOUR } from "@/lib/guard/rate-limit";
import { CACHE_TTL_DAYS } from "@/lib/search/cache-key";
import { googleAnalyticsId } from "@/lib/settings/queries";
import {
  AnalyticsBasisItem,
  AnalyticsRetentionItem,
  AnalyticsSharingItem,
  AnalyticsSummary,
  AnalyticsTracking,
} from "./analytics";
import { NEWSLETTER_PRIVACY_SECTION, NewsletterPrivacy } from "./newsletter";

export const metadata: Metadata = {
  title: "מדיניות פרטיות",
  description: `איזה מידע האתר ״${BRAND.name}״ שומר, למה, כמה זמן ועם מי הוא משותף.`,
};

// Every statement here must stay true of the code. Sources: search_log and clicks
// (lib/search/supabase-store.ts logSearch / logClick), rate_limits (lib/guard/rate-limit.ts,
// lib/admin/login-rate.ts), parse_cache / search_cache (lib/search/cache-key.ts), /searches
// (lib/recent/privacy.ts, isListableSearch in lib/search/pipeline.ts), admin sign-in
// (lib/admin/*, proxy.ts), vercel.json (fra1), Supabase project region eu-central-1, the LLM
// inputs (lib/llm/parse.ts, explain.ts, tips.ts), next.config.ts (images through /_next/image),
// components/product-video.tsx (played from AliExpress), the AliExpress gateway in Singapore
// (ALIEXPRESS_GATEWAY in lib/env.ts), Supabase Auth's own records (auth.sessions ip and
// user_agent, auth.audit_log_entries ip_address). Retention: RETENTION in lib/config/legal.ts,
// true only once supabase/migrations/20260928200000_retention.sql is applied (a deploy gate).
const SEC = {
  controller: { id: "controller", title: "מי אחראי למידע" },
  collected: { id: "collected", title: "איזה מידע נשמר ולמה" },
  public: { id: "public-searches", title: "חיפושים שמוצגים לכל הגולשים" },
  basis: { id: "basis", title: "על מה מבוסס השימוש במידע" },
  retention: { id: "retention", title: "כמה זמן המידע נשמר" },
  sharing: { id: "sharing", title: "עם מי המידע משותף" },
  tracking: { id: "tracking", title: "עוגיות וכלי מעקב" },
  newsletter: NEWSLETTER_PRIVACY_SECTION,
  security: { id: "security", title: "אבטחת מידע" },
  rights: { id: "rights", title: "הזכויות שלכם" },
  children: { id: "children", title: "ילדים" },
  changes: { id: "changes", title: "שינויים במדיניות" },
  contact: { id: "contact", title: "יצירת קשר" },
} as const satisfies Record<string, PageSection>;

export default async function PrivacyPage() {
  // Google Analytics (./analytics.tsx) is described only while the owner has set its id: the same
  // cached setting the root layout reads, so the page stays static and changes with it.
  const analytics = (await googleAnalyticsId()) !== null;
  return (
    <StaticPage
      page="privacy"
      sections={Object.values(SEC)}
      intro={
        <>
          <p>
            המדיניות מסבירה איזה מידע האתר ״{BRAND.name}״ שומר, למה, כמה זמן ועם מי הוא משותף. היא
            מתארת את האתר כפי שהוא בנוי היום.
          </p>
          <p>
            בקצרה: אין באתר חשבונות משתמש, ואנחנו לא מבקשים שם או טלפון. אימייל נבקש רק אם תבחרו
            להירשם לעדכונים על מבצעים וקופונים. <AnalyticsSummary inUse={analytics} /> את מה שאתם
            כותבים בחיפוש אנחנו שומרים בלי פרטים על מי שחיפש, ואת כתובת ה־IP שלכם שומרים במסד
            הנתונים שלנו רק כערך מגובב (hash) חד־כיווני, לזמן קצר.
          </p>
        </>
      }
    >
      <LegalSection {...SEC.controller}>
        <p>
          האחראי למידע שנשמר באתר הוא מפעיל האתר, <OperatorName />. לפניות בנושא פרטיות:{" "}
          <ContactEmail />.
        </p>
      </LegalSection>

      <LegalSection {...SEC.collected}>
        <h3>החיפושים</h3>
        <p>
          על כל חיפוש נשמרים: הטקסט שכתבתם, מה שהבנו ממנו (סוג המוצר, דרישות, טווח מחיר ומיון), מזהי
          המוצרים שהוצגו והקטגוריה של הראשון שבהם, סינונים שהסרתם או מיון שבחרתם, איך הגעתם לחיפוש
          (הקלדה, דוגמה, חיפוש אחרון, או קישור ממודעה או מקמפיין), נתונים טכניים על החיפוש (זמני
          תגובה, מספר הפניות לאלי אקספרס, כמה מוצרים נפסלו ובאיזה שלב, תקלה אם הייתה), מזהה אקראי של
          החיפוש והשעה.
        </p>
        <p>
          הרשומה לא כוללת כתובת IP, מזהה של הדפדפן או המכשיר, עוגייה או כל פרט אחר שמזהה אתכם.
          המטרה: להציג לכם את התוצאות, לשפר את איכות החיפוש, לחשב סטטיסטיקות שימוש ולהציג חיפושים
          אחרונים (בסעיף הבא).
        </p>

        <h3>לחיצות על קישורים לאלי אקספרס</h3>
        <p>
          כשאתם לוחצים על כפתור קנייה או על הקישור לביקורות, נשמרים: מזהה המוצר, איזה כפתור נלחץ,
          השעה, ואם הלחיצה הייתה בתוצאות חיפוש, גם המזהה האקראי של החיפוש ומיקום הכרטיס. בלי כתובת
          IP ובלי פרטים מזהים. המטרה: לדעת אילו תוצאות עוזרות, ולבדוק שהקישורים עובדים.
        </p>

        <h3>מניעת שימוש לרעה</h3>
        <p>
          כדי לאכוף את מגבלת החיפושים ({SEARCHES_PER_HOUR} בשעה, {SEARCHES_PER_DAY} ביום) ואת מגבלת
          בקשות הכניסה לעמוד הניהול ({ADMIN_LOGINS_PER_HOUR} בשעה), אנחנו סופרים בקשות לפי ערך מגובב
          (hash) חד־כיווני של כתובת ה־IP: גיבוב SHA-256 של הכתובת יחד עם ערך סודי. את הכתובת עצמה
          אנחנו לא שומרים. נשמרים רק הערך המגובב, חלון הזמן ומספר הבקשות.
        </p>

        <h3>מטמון חיפושים</h3>
        <p>
          כדי שחיפוש זהה לא יחכה ולא יעלה פעמיים, נשמרים טקסט החיפוש, מה שהבנו ממנו והתוצאות. המטמון
          משותף לכל הגולשים, ולא מקושר לאף אחד מהם.
        </p>

        <h3>מוצרים ושימוש במודל השפה</h3>
        <p>
          פרטי המוצרים שהוצגו (שם, מחיר, תמונות, משוב ומכירות) והיסטוריית המחירים שלהם, ורישום של
          כמות השימוש במודל השפה ועלותו, בלי תוכן החיפוש. זה מידע על מוצרים ועל השירות, לא עליכם.
        </p>

        <h3>מנהלי האתר</h3>
        <p>
          הכניסה לעמוד הניהול היא בקישור שנשלח לאימייל, ורק לכתובות שהוגדרו מראש. גולשים לא נרשמים
          ולא מתחברים. על מנהלי האתר נשמרות כתובות האימייל שלהם, ושירות הכניסה (Supabase Auth) שומר
          גם רשומות של ההתחברויות, כולל כתובת IP וסוג הדפדפן, ויומנים משלו. הבקשה שנשלחת כשפותחים את
          קישור הכניסה מגיעה מהדפדפן ישירות ל־Supabase.
        </p>

        <h3>יומנים של ספק האחסון</h3>
        <p>
          כמו בכל אתר, כל בקשה מגיעה לספק האחסון (Vercel), שמקבל את כתובת ה־IP ופרטי הבקשה, כמו
          כתובת העמוד (שבה עשוי להופיע טקסט החיפוש) וסוג הדפדפן, ושומר יומנים טכניים לזמן מוגבל לפי
          המדיניות שלו.
        </p>
      </LegalSection>

      <LegalSection {...SEC.public}>
        <p>
          חיפוש שהקלדתם ושמצא מוצרים יכול להופיע בעמוד{" "}
          <Link href="/searches">החיפושים האחרונים</Link>: הטקסט, מה שהבנו ממנו, תמונות של עד 3
          מוצרים שנמצאו, הקטגוריה והשעה, מעוגלת לשעה שלמה. בעמוד הבית מוצגים רק סוג המוצר שהבנו
          ותמונה, לא הטקסט שכתבתם.
        </p>
        <p>לא יוצגו שם:</p>
        <ul>
          <li>
            חיפוש שיש בו 7 ספרות או יותר ברצף (כמו מספר טלפון או תעודת זהות), הסימן @ (כמו באימייל
            או בשם משתמש), או משהו שנראה כמו כתובת אתר.
          </li>
          <li>
            חיפוש שלא הקלדתם בעצמכם: דוגמה שלחצתם עליה, חיפוש אחרון שפתחתם, או קישור ממודעה או
            מקמפיין. גם חיפוש שהסרתם בו סינון או שיניתם בו את המיון.
          </li>
          <li>חיפוש שלא מצא מוצרים.</li>
        </ul>
        <p>
          מנהלי האתר יכולים להסתיר חיפושים לא ראויים. כדי שחיפוש שהוסתר לא יחזור לעמוד, נשמר הנוסח
          שלו. בכל מקרה, אל תכתבו בחיפוש פרטים אישיים, שלכם או של אחרים.
        </p>
      </LegalSection>

      <LegalSection {...SEC.basis}>
        <ul>
          <li>
            אין חובה חוקית למסור לנו מידע, והשימוש באתר לא דורש פרטים מזהים. אתם בוחרים מה לכתוב
            בחיפוש.
          </li>
          <li>את החיפוש אנחנו שומרים ומעבדים כי הוא נדרש כדי לתת את השירות שביקשתם.</li>
          <li>את הערך המגובב של כתובת ה־IP אנחנו שומרים לצורך אבטחה ומניעת שימוש לרעה.</li>
          <li>נתוני השימוש, בלי פרטים מזהים, משמשים לשיפור השירות ולסטטיסטיקה.</li>
          <AnalyticsBasisItem inUse={analytics} />
        </ul>
      </LegalSection>

      <LegalSection {...SEC.retention}>
        <ul>
          <li>
            הערכים המגובבים של כתובות ה־IP ומוני המגבלות: נמחקים {RETENTION.rateLimitHours} שעות
            אחרי שחלון הזמן שלהם נגמר.
          </li>
          <li>
            רשומות החיפושים: נמחקות אחרי {RETENTION.searchLogMonths} חודשים. לכן חיפוש שמוצג בעמוד
            החיפושים האחרונים יורד ממנו לכל המאוחר באותו מועד.
          </li>
          <li>
            הנוסח של חיפושים שהסתרנו מעמוד החיפושים האחרונים: נמחק {RETENTION.hiddenSearchMonths}{" "}
            חודשים אחרי ההסתרה, או {RETENTION.hiddenSearchMonths} חודשים אחרי החיפוש האחרון בנוסח
            הזה, אם הוא מאוחר יותר.
          </li>
          <li>רשומות הלחיצות: נמחקות אחרי {RETENTION.clicksMonths} חודשים.</li>
          <li>
            המטמון: משמש עד {CACHE_TTL_DAYS} יום, ונמחק {RETENTION.cacheRowDays} יום אחרי שנוצר.
          </li>
          <li>
            נתוני השימוש במודל השפה והיסטוריית המחירים, שאין בהם מידע עליכם: נמחקים אחרי{" "}
            {RETENTION.usageAndPricesMonths} חודשים.
          </li>
          <li>כתובות האימייל של מנהלי האתר: עד שהמשתמש שלהם נמחק.</li>
          <li>רשומות ההתחברות של מנהלי האתר והיומנים של שירות הכניסה: לפי המדיניות של Supabase.</li>
          <li>היומנים של ספק האחסון: לפי המדיניות של Vercel.</li>
          <AnalyticsRetentionItem inUse={analytics} />
        </ul>
        <p>המחיקה נעשית אוטומטית פעם ביום, ולכן רשומה עשויה להישאר עד יום אחד אחרי המועד.</p>
      </LegalSection>

      <LegalSection {...SEC.sharing}>
        <p>
          אנחנו לא מוכרים מידע ולא מעבירים אותו למפרסמים. אלה הספקים שמעבדים מידע כדי שהשירות יעבוד:
        </p>
        <ul>
          <li>
            Vercel (ארצות הברית): אחסון האתר והרצת הקוד. הקוד שלנו רץ באזור פרנקפורט, גרמניה,
            והבקשות עוברות ברשת השרתים של Vercel. מקבלת כל בקשה לאתר, כולל כתובת IP.
          </li>
          <li>
            Supabase: מסד הנתונים והכניסה של מנהלי האתר, באזור פרנקפורט, גרמניה. כל המידע שמתואר
            למעלה נשמר שם.
          </li>
          <li>
            Anthropic (ארצות הברית), ספקית מודל השפה: מקבלת את טקסט החיפוש כדי להבין אותו; את נתוני
            המוצרים והסינונים, בלי טקסט החיפוש, כדי לנסח את ההסברים; ושמות של קטגוריות לטיפים. לא
            נשלחים אליה כתובת IP או פרט מזהה.
          </li>
          <li>
            אלי אקספרס: דרך ממשק תוכנית השותפים (בשרתים שלה בסינגפור) נשלחות אליה מילות חיפוש
            באנגלית שהפקנו מהחיפוש, טווח המחיר ומזהי מוצרים, בלי פרט מזהה עליכם. כשאתם עוברים לאלי
            אקספרס או מפעילים סרטון מוצר, הדפדפן שלכם פונה אליה ישירות, והיא פועלת לפי מדיניות
            הפרטיות שלה.
          </li>
          <AnalyticsSharingItem inUse={analytics} />
        </ul>
        <p>
          הספקים נמצאים מחוץ לישראל, באיחוד האירופי, בארצות הברית ובסינגפור, ולכן המידע מועבר אליהם
          לצורך השירות. נמסור מידע לרשויות רק אם נחויב לכך לפי דין.
        </p>
      </LegalSection>

      {/* Analytics (Google Analytics, while the owner has set its id): ./analytics.tsx. */}
      <LegalSection {...SEC.tracking}>
        <AnalyticsTracking inUse={analytics} />
      </LegalSection>

      {/* Newsletter (the footer's sign-up for email updates): ./newsletter.tsx. */}
      <LegalSection {...SEC.newsletter}>
        <NewsletterPrivacy />
      </LegalSection>

      <LegalSection {...SEC.security}>
        <ul>
          <li>החיבור לאתר מוצפן (HTTPS).</li>
          <li>
            המפתחות לשירותים (אלי אקספרס, מודל השפה, מסד הנתונים) נשמרים בשרת בלבד ולא מגיעים
            לדפדפן.
          </li>
          <li>
            מסד הנתונים מוגן בהרשאות לכל שורה (RLS): מהדפדפן אפשר לקרוא רק תוכן שפורסם, כמו דילים,
            קופונים ועמודי חיפוש. כל השאר נגיש רק לשרת.
          </li>
          <li>כתובות IP של גולשים נשמרות במסד הנתונים שלנו רק כערך מגובב חד־כיווני עם ערך סודי.</li>
          <li>
            הכניסה לניהול היא בקישור חד־פעמי שנשלח לאימייל, רק לכתובות מורשות, ועוגיית ההתחברות לא
            נגישה לסקריפטים בדף.
          </li>
        </ul>
        <p>אף מערכת לא חסינה לחלוטין, אבל אנחנו שומרים מעט מידע ככל האפשר.</p>
      </LegalSection>

      <LegalSection {...SEC.rights}>
        <p>
          לפי חוק הגנת הפרטיות, התשמ״א־1981, אתם רשאים לעיין במידע עליכם שנשמר אצלנו, ולבקש לתקן או
          למחוק מידע שאינו נכון, שלם, ברור או מעודכן.
        </p>
        <p>
          אנחנו לא מקשרים חיפושים ולחיצות לאדם, ולכן לא נוכל למצוא לבד את החיפושים שלכם. אם כתבתם
          בחיפוש פרט אישי ואתם רוצים שנמחק אותו, כתבו לנו את נוסח החיפוש ובערך מתי חיפשתם, ונמחק את
          הרשומות המתאימות.
        </p>
        <p>
          פניות: <ContactEmail />. אפשר גם לפנות לרשות להגנת הפרטיות.
        </p>
      </LegalSection>

      <LegalSection {...SEC.children}>
        <p>
          האתר לא מיועד במיוחד לילדים, ואין בו חשבונות משתמש. הפרט המזהה היחיד שאפשר למסור בו הוא
          אימייל להרשמה לעדכונים, מרצון. הורים: אם ילד כתב בחיפוש פרטים אישיים או נרשם לעדכונים, פנו
          אלינו ונמחק אותם.
        </p>
      </LegalSection>

      <LegalSection {...SEC.changes}>
        <p>
          כשהאתר ישתנה באופן שנוגע למידע, נעדכן את המדיניות בעמוד הזה, והתאריך בראש העמוד יתעדכן.
        </p>
      </LegalSection>

      <LegalSection {...SEC.contact}>
        <p>
          שאלות ובקשות בנושא פרטיות: <ContactEmail />.
        </p>
      </LegalSection>
    </StaticPage>
  );
}
