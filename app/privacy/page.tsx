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
import { LEGAL_PATHS, RETENTION } from "@/lib/config/legal";
import { MY_SEARCHES_MAX } from "@/lib/recent/mine";
import { SEARCHES_PER_DAY, SEARCHES_PER_HOUR } from "@/lib/guard/rate-limit";
import { CACHE_TTL_DAYS } from "@/lib/search/cache-key";
import { publicSettings } from "@/lib/settings/queries";
import {
  AnalyticsBasisItem,
  AnalyticsRetentionItem,
  AnalyticsSharingItem,
  AnalyticsSummary,
  AnalyticsTracking,
} from "./analytics";
import {
  MarketingBasisItem,
  MarketingRetentionItem,
  MarketingRights,
  MarketingSharingItem,
  MarketingSummary,
  MarketingTracking,
} from "./marketing";
import { NEWSLETTER_PRIVACY_SECTION, NewsletterPrivacy } from "./newsletter";
import { WHATSAPP_PRIVACY_SECTION, WhatsAppPrivacy } from "./whatsapp";
import { whatsappEnabled } from "@/lib/whatsapp/config";
import { pageMetadata } from "@/lib/seo/page-meta";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "מדיניות פרטיות",
    description: `איזה מידע האתר ״${BRAND.name}״ שומר, למה, כמה זמן ועם מי הוא משותף.`,
    path: "/privacy",
  }),
};

// Every statement here must stay true of the code. Sources: search_log and clicks
// (lib/search/supabase-store.ts logSearch / logClick), rate_limits (lib/guard/rate-limit.ts,
// lib/admin/login-rate.ts), parse_cache / search_cache (lib/search/cache-key.ts), /searches
// (lib/recent/privacy.ts, isListableSearch in lib/search/pipeline.ts), admin sign-in
// (lib/admin/*, proxy.ts), vercel.json (fra1), Supabase project region eu-central-1, the LLM
// inputs (lib/llm/parse.ts, explain.ts, tips.ts), lib/images.ts (photos loaded by the browser from
// AliExpress's image CDN, never through /_next/image; Referrer-Policy strict-origin-when-cross-origin
// in next.config.ts sends it the page's origin only),
// components/product-video.tsx (loaded from AliExpress's video host when /p opens and autoplayed
// muted, not under reduced motion or Save-Data), "החיפושים שלי" (lib/recent/mine.ts, this browser
// only), the crawler guard (lib/guard/bots.ts: the user agent is read, never stored), the
// AliExpress gateway in Singapore
// (ALIEXPRESS_GATEWAY in lib/env.ts), Supabase Auth's own records (auth.sessions ip and
// user_agent, auth.audit_log_entries ip_address), Google Analytics (./analytics.tsx) and the
// Meta Pixel (./marketing.tsx) while their ids are set. Retention: RETENTION in lib/config/legal.ts,
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
  whatsapp: WHATSAPP_PRIVACY_SECTION,
  security: { id: "security", title: "אבטחת מידע" },
  rights: { id: "rights", title: "הזכויות שלכם" },
  children: { id: "children", title: "ילדים" },
  changes: { id: "changes", title: "שינויים במדיניות" },
  contact: { id: "contact", title: "יצירת קשר" },
} as const satisfies Record<string, PageSection>;

export default async function PrivacyPage() {
  // Google Analytics (./analytics.tsx) and the Meta Pixel (./marketing.tsx) are described only
  // while the owner has set their ids: the same cached settings the root layout reads, so the page
  // stays static and changes with them.
  const { measurementId, metaPixelId } = await publicSettings();
  const analytics = measurementId !== null;
  const marketing = metaPixelId !== null;
  // The WhatsApp bot (./whatsapp.tsx) is described only while it is switched on (its secrets set).
  const whatsapp = whatsappEnabled();
  return (
    <StaticPage
      page="privacy"
      sections={Object.values(SEC).filter((s) => whatsapp || s.id !== WHATSAPP_PRIVACY_SECTION.id)}
      intro={
        <>
          <p>
            המדיניות מסבירה איזה מידע האתר ״{BRAND.name}״ שומר, למה, כמה זמן ועם מי הוא משותף. היא
            מתארת את האתר כפי שהוא בנוי היום.
          </p>
          <p>
            בקצרה: אין באתר חשבונות משתמש, ואנחנו לא מבקשים שם או טלפון. אימייל נבקש רק אם תבחרו
            להירשם לעדכונים על מבצעים וקופונים.{" "}
            {marketing ? (
              <MarketingSummary analytics={analytics} />
            ) : (
              <AnalyticsSummary inUse={analytics} />
            )}{" "}
            את מה שאתם כותבים בחיפוש אנחנו שומרים בלי פרטים על מי שחיפש, ואת כתובת ה־IP שלכם שומרים
            במסד הנתונים שלנו רק כערך מגובב (hash) חד־כיווני, לזמן קצר.
            {whatsapp && (
              <>
                {" "}
                אם תכתבו לנו בוואטסאפ, וואטסאפ תעביר אלינו את מספר הטלפון שלכם, אבל אנחנו לא שומרים
                אותו (הפרטים בסעיף על הבוט).
              </>
            )}
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
          (הקלדה, דוגמה, חיפוש אחרון, קישור ממודעה או מקמפיין, או בקשה של סורק אוטומטי שקיבל תוצאות
          שכבר היו שמורות), נתונים טכניים על החיפוש (זמני תגובה, מספר הפניות לאלי אקספרס, כמה מוצרים
          נפסלו ובאיזה שלב, תקלה אם הייתה), מזהה אקראי של החיפוש והשעה.
        </p>
        <p>
          הרשומה לא כוללת כתובת IP, מזהה של הדפדפן או המכשיר, עוגייה או כל פרט אחר שמזהה אתכם.
          המטרה: להציג לכם את התוצאות, לשפר את איכות החיפוש, לחשב סטטיסטיקות שימוש ולהציג חיפושים
          אחרונים (בסעיף הבא).
        </p>

        <h3>״החיפושים שלי״, רק בדפדפן שלכם</h3>
        <p>
          כדי שתוכלו לחזור לחיפושים שלכם, הדפדפן שלכם שומר את {MY_SEARCHES_MAX} החיפושים האחרונים
          שעשיתם בו (הטקסט והשעה), באחסון המקומי שלו (localStorage), ומציג אותם לכם תחת ״החיפושים
          שלי״ בעמוד הבית ובעמוד החיפושים האחרונים. הרשימה הזאת לא נשלחת אלינו ולא לאף אחד אחר,
          ואחרים לא רואים אותה. אפשר להסיר ממנה חיפוש בכפתור ה־× שלו, או למחוק את כולה בכפתור
          ״ניקוי״. הפירוט ב<Link href={LEGAL_PATHS.cookies}>מדיניות העוגיות</Link>.
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
        <p>
          חיפוש חדש עולה לנו כסף (מודל השפה ואלי אקספרס), ולכן הוא פועל רק לגולשים. כדי לזהות סורקים
          וכלים אוטומטיים, אנחנו בודקים את סוג הדפדפן שהבקשה מדווחת עליו (User-Agent). סורק מקבל רק
          תוצאות שכבר שמורות אצלנו, או עמוד שמפנה לתוכן האתר. סוג הדפדפן לא נשמר.
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
          כל חיפוש שמצא מוצרים יכול להופיע בעמוד <Link href="/searches">החיפושים האחרונים</Link>,
          בלי קשר לאיך הוא התחיל: הקלדתם אותו, לחצתם על דוגמה או על חיפוש אחרון, הגעתם מקישור של
          מודעה או קמפיין, הסרתם סינון או שיניתם מיון. בעמוד מוצגים: הטקסט של החיפוש, מה שהבנו ממנו,
          תמונות של עד 3 מוצרים שנמצאו, הקטגוריה והשעה, מעוגלת לשעה שלמה. לכל נוסח של חיפוש מוצג
          כרטיס אחד, של הפעם האחרונה שחיפשו אותו. בעמוד הבית מוצגים רק סוג המוצר שהבנו ותמונה, לא
          הטקסט של החיפוש.
        </p>
        <p>אף פעם לא יוצגו:</p>
        <ul>
          <li>
            חיפוש שיש בו 7 ספרות או יותר ברצף (כמו מספר טלפון או תעודת זהות), הסימן @ (כמו באימייל
            או בשם משתמש), או משהו שנראה כמו כתובת אתר.
          </li>
          <li>חיפוש שלא מצא מוצרים: אין בו מוצר להציג.</li>
          <li>חיפוש שנכשל, ובקשה של סורק או כלי אוטומטי.</li>
        </ul>
        <p>
          מנהלי האתר יכולים להסתיר חיפושים לא ראויים. כדי שחיפוש שהוסתר לא יחזור לעמוד, נשמר הנוסח
          שלו. בכל מקרה, אל תכתבו בחיפוש פרטים אישיים, שלכם או של אחרים.
        </p>
        <p>
          ״החיפושים שלי״, שמוצגים לכם מעל החיפושים של כולם, הם רשימה אחרת: היא נשמרת רק בדפדפן שלכם,
          ואחרים לא רואים אותה (בסעיף הקודם).
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
          <MarketingBasisItem inUse={marketing} />
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
            ״החיפושים שלי״: בדפדפן שלכם בלבד, עד שתנקו אותם או תמחקו את נתוני האתר בדפדפן. אצלנו הם
            לא נשמרים.
          </li>
          <li>
            המטמון: משמש עד {CACHE_TTL_DAYS} יום, ונמחק {RETENTION.cacheRowDays} יום אחרי שנוצר.
          </li>
          <li>
            נתוני השימוש במודל השפה והיסטוריית המחירים, שאין בהם מידע עליכם: נמחקים אחרי{" "}
            {RETENTION.usageAndPricesMonths} חודשים.
          </li>
          <li>כתובות האימייל של מנהלי האתר: עד שהמשתמש שלהם נמחק.</li>
          <li>רשומות ההתחברות של מנהלי האתר והיומנים של שירות הכניסה: לפי המדיניות של Supabase.</li>
          <li>היומנים של ספק האחסון ונתוני ספירת הביקורים: לפי המדיניות של Vercel.</li>
          <AnalyticsRetentionItem inUse={analytics} />
          <MarketingRetentionItem inUse={marketing} />
        </ul>
        <p>המחיקה נעשית אוטומטית פעם ביום, ולכן רשומה עשויה להישאר עד יום אחד אחרי המועד.</p>
      </LegalSection>

      <LegalSection {...SEC.sharing}>
        <p>
          {marketing
            ? "אנחנו לא מוכרים מידע. לרשת פרסום עובר מידע רק דרך Meta Pixel, ורק ממי שאישר עוגיות שיווק (בהמשך הרשימה). אלה הספקים שמעבדים מידע כדי שהשירות יעבוד, ו־Meta:"
            : "אנחנו לא מוכרים מידע ולא מעבירים אותו למפרסמים. אלה הספקים שמעבדים מידע כדי שהשירות יעבוד:"}
        </p>
        <ul>
          <li>
            Vercel (ארצות הברית): אחסון האתר והרצת הקוד. הקוד שלנו רץ באזור פרנקפורט, גרמניה,
            והבקשות עוברות ברשת השרתים של Vercel. מקבלת כל בקשה לאתר, כולל כתובת IP, ואת נתוני ספירת
            הביקורים שמפורטים בסעיף ״עוגיות וכלי מעקב״.
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
            באנגלית שהפקנו מהחיפוש, טווח המחיר ומזהי מוצרים, בלי פרט מזהה עליכם. כשעמוד מציג תמונות
            מוצרים, הדפדפן שלכם טוען אותן ישירות משרתי התמונות של אלי אקספרס, שמקבלים בכך את כתובת
            ה־IP שלכם, את סוג הדפדפן ואת כתובת העמוד שממנו נטענה התמונה. כך גם כשאתם עוברים לאלי
            אקספרס, וכשנפתח עמוד של מוצר שיש לו סרטון: הסרטון נטען משרתי הווידאו של אלי אקספרס
            ומתחיל לפעול בלי קול מיד עם פתיחת העמוד (אם ביקשתם במכשיר להפחית תנועה או לחסוך בנתונים,
            הוא נטען רק כשתפעילו אותו). היא פועלת לפי מדיניות הפרטיות שלה.
          </li>
          <AnalyticsSharingItem inUse={analytics} />
          <MarketingSharingItem inUse={marketing} />
          {whatsapp && (
            <li>
              Meta (וואטסאפ): רק למי שכותב לנו בוואטסאפ. ההודעות ומספר הטלפון עוברים דרך פלטפורמת
              WhatsApp Business שלה, והיא מעבדת אותם לפי התנאים והמדיניות שלה.
            </li>
          )}
        </ul>
        <p>
          הספקים נמצאים מחוץ לישראל, באיחוד האירופי, בארצות הברית ובסינגפור, ולכן המידע מועבר אליהם
          לצורך השירות. נמסור מידע לרשויות רק אם נחויב לכך לפי דין.
        </p>
      </LegalSection>

      {/* Analytics (Google Analytics, while the owner has set its id): ./analytics.tsx; the Meta
          Pixel, while its id is set: ./marketing.tsx. */}
      <LegalSection {...SEC.tracking}>
        <AnalyticsTracking inUse={analytics} marketingInUse={marketing} />
        <MarketingTracking inUse={marketing} />
      </LegalSection>

      {/* Newsletter (the footer's sign-up for email updates): ./newsletter.tsx. */}
      <LegalSection {...SEC.newsletter}>
        <NewsletterPrivacy />
      </LegalSection>

      {/* The WhatsApp bot, while it is switched on: ./whatsapp.tsx. */}
      {whatsapp && (
        <LegalSection {...SEC.whatsapp}>
          <WhatsAppPrivacy />
        </LegalSection>
      )}

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
        <MarketingRights inUse={marketing} />
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
