import type { Metadata } from "next";
import Link from "next/link";
import {
  ContactEmail,
  LegalSection,
  OperatorName,
  StaticPage,
  type PageSection,
} from "@/components/static-page";
import { BRAND } from "@/lib/config/brand";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { AFFILIATE_SECTION_ID, LEGAL_PATHS } from "@/lib/config/legal";
import { AFFILIATE_NOTE } from "@/lib/copy";
import { SEARCHES_PER_DAY, SEARCHES_PER_HOUR } from "@/lib/guard/rate-limit";
import { PRODUCTS_PATH } from "@/lib/hot/params";
import { FILL_TIER, FILTERS, LOOSE_TIER } from "@/lib/ranking/config";
import { pageMetadata } from "@/lib/seo/page-meta";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "תקנון ותנאי שימוש",
    description: `התנאים לשימוש ב${BRAND.name}, כולל גילוי נאות על קישורי השותפים של אלי אקספרס.`,
    path: "/terms",
  }),
};

// Every statement here must stay true of the code; the sources are named next to each section.
const SEC = {
  operator: { id: "operator", title: "מי מפעיל את האתר" },
  service: { id: "service", title: "מה השירות עושה" },
  accuracy: { id: "accuracy", title: "דיוק המידע" },
  affiliate: { id: AFFILIATE_SECTION_ID, title: "גילוי נאות: קישורי שותפים" },
  coupons: { id: "coupons", title: "קופונים, קודי הנחה ומבצעים" },
  use: { id: "use", title: "שימוש מותר" },
  ip: { id: "ip", title: "קניין רוחני" },
  liability: { id: "liability", title: "הגבלת אחריות" },
  links: { id: "links", title: "קישורים לאתרים אחרים" },
  changes: { id: "changes", title: "שינויים בתקנון" },
  law: { id: "law", title: "דין ושיפוט" },
  contact: { id: "contact", title: "יצירת קשר" },
} as const satisfies Record<string, PageSection>;

export default function TermsPage() {
  return (
    <StaticPage
      page="terms"
      sections={Object.values(SEC)}
      intro={
        <p>
          התקנון מסביר מה האתר ״{BRAND.name}״ עושה, על מה אפשר לסמוך בו ומה התנאים לשימוש בו. השימוש
          באתר הוא הסכמה לתנאים האלה. התקנון כתוב בלשון רבים ופונה לכל המגדרים.
        </p>
      }
    >
      <LegalSection {...SEC.operator}>
        <p>
          האתר {BRAND.name} מופעל על ידי <OperatorName />. בתקנון, ״אנחנו״ הוא מפעיל האתר.
        </p>
        <p>
          זה אתר עצמאי. הוא משתתף בתוכנית השותפים של אלי אקספרס, אבל הוא לא חלק מאלי אקספרס ולא מדבר
          בשמה.
        </p>
      </LegalSection>

      {/* The search pipeline (CLAUDE.md §6), /hot, /coupons, /sales and the guard limits. */}
      <LegalSection {...SEC.service}>
        <p>
          כותבים בעברית מה מחפשים, ואנחנו מחפשים באלי אקספרס, מסננים ומציגים כמה מוצרים שעברו את
          הסינון, עם משפט קצר על הסיבה שכל אחד מהם נבחר. באתר יש גם רשימת מוצרים חמים של אלי אקספרס,
          קופונים ולוח של המבצעים הגדולים.
        </p>
        <ul>
          <li>
            אנחנו שירות חיפוש והמלצה, לא חנות. אנחנו לא מוכרים מוצרים, לא מחזיקים מלאי, לא גובים
            תשלום ולא אחראים למשלוח, לאחריות, להחזרות או לשירות הלקוחות.
          </li>
          <li>
            הקנייה עצמה נעשית באתר של אלי אקספרס, מול אלי אקספרס והמוכר, לפי התנאים ומדיניות הפרטיות
            שלהם. שאלות על הזמנה, תשלום, משלוח או החזרה מופנות אליהם.
          </li>
          <li>
            השירות ניתן בחינם, כמות שהוא. ייתכנו בו תקלות והפסקות, ואנחנו רשאים לשנות, להגביל או
            להפסיק חלקים ממנו.
          </li>
          <li>
            כדי לשמור על השירות יש מגבלת שימוש: עד {SEARCHES_PER_HOUR} חיפושים בשעה ועד{" "}
            {SEARCHES_PER_DAY} ביום מאותה כתובת רשת (IP), ומגבלה יומית כללית על מספר החיפושים באתר.
            כשמגיעים למגבלה מופיעה הודעה, ואפשר לנסות שוב מאוחר יותר.
          </li>
        </ul>
      </LegalSection>

      {/* CLAUDE.md §1 (honest data), §5.3, §6 (filters, explain post-checks), §7 (/p, /hot).
          The thresholds: FILTERS, FILL_TIER and LOOSE_TIER (lib/ranking/config.ts; a search ranks
          exact first, rankForSearch in lib/ranking/rank.ts; SEO refreshes too); hot lists pass FILTERS only (lib/hot/). /p shows any saved product
          with its checks against FILTERS (app/p/[productId]/product-view.tsx), including products
          the admin imported for a deal or coupon (lib/deals/import-product.ts,
          lib/coupons/product-import.ts: no trust filter). */}
      <LegalSection {...SEC.accuracy}>
        <ul>
          <li>
            המחירים, אחוז המשוב החיובי ומספר המכירות מגיעים מאלי אקספרס, דרך הממשק של תוכנית השותפים
            שלה. אנחנו לא ממציאים נתונים ולא משנים אותם.
          </li>
          <li>
            המחירים הם מה שאלי אקספרס הציגה כשבדקנו את המוצר, והם משתנים כל הזמן. בעמוד של כל מוצר
            כתוב מתי בדקנו את המחיר. מחיר שהמרנו מדולרים מסומן ב־≈ והוא משוער. המחיר הקובע הוא המחיר
            שמוצג בקופה באלי אקספרס, לפני התשלום.
          </li>
          <li>
            בתוצאות החיפוש אנחנו מציגים רק מוצרים ששם המוצר שלהם מתאים למה שחיפשתם. קודם מוצרים
            שעברו את הסינון: {FILTERS.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות{" "}
            {FILTERS.minUnitsSold} מכירות ב־30 הימים האחרונים, או {FILL_TIER.minPositiveFeedbackPct}
            % ומעלה ולפחות {FILL_TIER.minUnitsSold} מכירות. אחריהם מוצרים שמתאימים בדיוק לחיפוש אבל
            פחות מוכחים, עם {LOOSE_TIER.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות{" "}
            {LOOSE_TIER.minUnitsSold} מכירות, ומסומנים ״פחות מוכח״. בסוף מוצרים קרובים למה שחיפשתם
            שעברו את הסינון. כך גם בעמודי החיפושים הפופולריים. ברשימת המוצרים החמים מוצגים רק מוצרים
            שעברו את הסינון.
          </li>
          <li>
            בעמוד של מוצר מוצגים הנתונים העדכניים שבדקנו, וכתוב אם המוצר עדיין עומד בספים שלנו.
            מוצרים שבחרנו בעצמנו לדילים או לקופונים לא תמיד עברו את הסינון, והעמוד שלהם מראה איך הם
            עומדים בו.
          </li>
          <li>
            הסינון מבוסס על נתוני אלי אקספרס, ואינו מבטיח את איכות המוצר, את אמינות המוכר או את
            המשלוח.
          </li>
          <li>
            מודל שפה (בינה מלאכותית) עוזר לנו בשלושה דברים: להבין את החיפוש שכתבתם, לנסח שם בעברית
            ומשפט קצר ״למה בחרנו״ על מוצרים מתוך הנתונים שקיבלנו מאלי אקספרס (בתוצאות הראשונות של
            חיפוש, {RESULTS_PER_PAGE} המוצרים הראשונים מקבלים משפט, והמוצרים שמתחתם רק שם בעברית),
            ולכתוב טיפים כלליים לקנייה לפי קטגוריה, שמסומנים ככלליים. החיפוש, הסינון והדירוג נעשים
            בקוד קבוע, לא על ידי המודל.
          </li>
          <li>
            המודל עלול לטעות: להבין חיפוש אחרת ממה שהתכוונתם, או לנסח משפט לא מדויק. אנחנו בודקים את
            הניסוחים בקוד ופוסלים, למשל, משפט עם מספר שלא הופיע בנתונים, אבל לא כל טעות נתפסת. בדקו
            את פרטי המוצר באלי אקספרס לפני שאתם קונים.
          </li>
          <li>שמות המוצרים ברשימת המוצרים החמים הם תרגום אוטומטי של אלי אקספרס, ומסומנים כך.</li>
          <li>
            אין באתר ביקורות של קונים או סיכומים שלהן. את הביקורות עצמן אפשר לקרוא באלי אקספרס.
          </li>
          <li>
            תוכן שאנחנו מוסיפים בעצמנו מסומן ככזה: קופונים (״לפי תנאי הקופון״) ותאריכי מבצעים
            (״תאריכים לפי אלי אקספרס ולפי המועדים של השנים הקודמות״).
          </li>
          <li>
            בעמוד הדילים אנחנו ממליצים על מוצרים ומבצעים, ולפעמים ממליצים לא לקנות מוצר. זו דעתנו,
            לא נתון של אלי אקספרס.
          </li>
        </ul>
      </LegalSection>

      {/* The full disclosure (owner decision 2026-09-28). Sources: /go (every link to AliExpress),
          lib/ranking/rank.ts (commission only breaks exact ties), lib/hot/links.ts (hot links).
          Only products with an affiliate link are shown (CLAUDE.md §6.7, lib/search/pipeline.ts,
          lib/hot/, lib/deals/import-product.ts "no_link"); besides feedback, sales and the match,
          price bounds, duplicate removal, shop diversity (lib/ranking/diversity.ts) and the hot
          lists' category exclusions decide what is shown. The only place that says so outside
          this section is /hot's "מאיפה הרשימה" (app/hot/page.tsx). */}
      <LegalSection {...SEC.affiliate}>
        <p>
          האתר משתתף בתוכנית השותפים של אלי אקספרס (AliExpress Affiliate Program). הקישורים לאלי
          אקספרס באתר, בכפתורי הקנייה ובקישור לביקורות, הם קישורי שותפים: הם עוברים דרך האתר שלנו
          ומשם לאלי אקספרס, עם קוד שמזהה אותנו כשותפים. ליד כל כפתור כזה מופיעות המילים ״
          {AFFILIATE_NOTE.label}״, שמובילות לסעיף הזה.
        </p>
        <ul>
          <li>
            אם תקנו באלי אקספרס אחרי שהגעתם אליה דרך קישור כזה, אלי אקספרס עשויה לשלם לנו עמלה קטנה.
            את העמלה משלמת אלי אקספרס, והיא לא מתווספת למחיר שלכם.
          </li>
          <li>
            אנחנו מחפשים רק בין המוצרים שאלי אקספרס מציעה בתוכנית השותפים שלה, ומוצר שאין לו קישור
            שותפים לא מוצג. מתוכם, מה שמוצג נקבע לפי המשוב, המכירות, ההתאמה לחיפוש והמחיר שביקשתם,
            ולפי כללים כמו הסרת כפילויות ומגוון של חנויות, בלי קשר לגובה העמלה.
          </li>
          <li>
            גם הדירוג לא נקבע לפי העמלה. גובה העמלה משמש רק כדי להכריע בין שני מוצרים שקיבלו בדיוק
            את אותו ציון. מוצר לא יעלה למעלה רק כי הוא משלם לנו יותר.
          </li>
          <li>
            רשימת המוצרים החמים (בעמוד <Link href={PRODUCTS_PATH}>כל המוצרים</Link>, בעמודי
            הקטגוריות שלו ובעמוד הבית) היא רשימה שאלי אקספרס מציעה לשותפים שלה, ועל רוב המוצרים בה
            היא מציעה עמלה גבוהה יותר. בעמוד כל המוצרים ובעמודי הקטגוריות זה כתוב גם ליד הרשימה. גם
            עליה חל הסינון שלנו, והעמלה לא משפיעה על הסינון ועל הסדר.
          </li>
          <li>
            כשאלי אקספרס מציעה על מוצר מהרשימה הזו עמלה גבוהה מהרגילה, הקישור שלנו אליו הוא מהסוג
            שמיועד לעמלה הזו. סוג הקישור לא משפיע על אילו מוצרים מוצגים ועל הסדר שלהם.
          </li>
          <li>כפתורי השיתוף משתפים קישור לעמוד שלנו, לא את קישור השותפים עצמו.</li>
        </ul>
      </LegalSection>

      {/* /coupons, /sales, SALE_DATES_NOTE and SALE_CODE_NOTE in lib/copy.ts; the community
          coupon on /p and /deals is a deals row the admin enters (components/community-coupon.tsx,
          COUPON_DISCLAIMER). */}
      <LegalSection {...SEC.coupons}>
        <ul>
          <li>
            את הקופונים באתר אנחנו מוסיפים ידנית, והם מסומנים ״לפי תנאי הקופון״. ההנחה ניתנת לפי
            התנאים של כל קופון, וחלק מהקודים מוגבלים בכמות, בזמן או בסכום קנייה מינימלי.
          </li>
          <li>
            קוד שמסומן ״קופון מהקהילה״ הוא קוד שאנחנו מוסיפים ידנית. הוא לא תמיד עובד לכולם, וחלק
            מהקודים מוגבלים בזמן או בכמות.
          </li>
          <li>
            קודי הנחה של אלי אקספרס למוצרים מסוימים מוצגים כפי שאלי אקספרס מסרה אותם, ורק בתקופת
            התוקף שהיא ציינה.
          </li>
          <li>
            תאריכי המבצעים הגדולים הם לפי הודעות אלי אקספרס, ואנחנו מעדכנים אותם ידנית. אלי אקספרס
            יכולה לשנות מבצע או לבטל אותו.
          </li>
          <li>
            איננו יכולים להבטיח שקוד יעבוד או שמבצע יתקיים כפי שפורסם. בדקו בקופה באלי אקספרס שההנחה
            התקבלה לפני התשלום.
          </li>
        </ul>
      </LegalSection>

      {/* /searches (lib/recent/privacy.ts, hidden_searches) and the guard limits. */}
      <LegalSection {...SEC.use}>
        <p>האתר מיועד לשימוש אישי. אסור:</p>
        <ul>
          <li>
            לאסוף נתונים מהאתר באופן אוטומטי (סריקה, scraping או בוטים), או לשלוח אליו חיפושים
            אוטומטיים.
          </li>
          <li>
            לעקוף את מגבלות השימוש, לשבש את פעולת האתר, לנסות לפרוץ אליו או לגשת לאזורים שלא פתוחים
            לציבור.
          </li>
          <li>לכתוב בחיפוש תוכן פוגעני או בלתי חוקי, או פרטים אישיים, שלכם או של אחרים.</li>
        </ul>
        <p>
          חיפושים שמצאו מוצרים עשויים להופיע בעמוד <Link href="/searches">החיפושים האחרונים</Link>,
          בלי פרטים על מי שחיפש (פירוט ב<Link href={LEGAL_PATHS.privacy}>מדיניות הפרטיות</Link>).
          אנחנו רשאים להסתיר חיפושים מהעמוד הזה ולחסום שימוש שמפר את התנאים.
        </p>
      </LegalSection>

      <LegalSection {...SEC.ip}>
        <ul>
          <li>
            העיצוב, הטקסטים שכתבנו, הלוגו והקוד של האתר שייכים למפעיל האתר. אין להעתיק אותם או
            להשתמש בהם למטרה מסחרית בלי אישור בכתב.
          </li>
          <li>
            שמות המוצרים, התמונות, הסרטונים ונתוני המוצרים שייכים לאלי אקספרס ולמוכרים, ומוצגים
            במסגרת תוכנית השותפים. השמות AliExpress ואלי אקספרס שייכים לבעליהם.
          </li>
          <li>מותר לשתף קישורים לעמודי האתר.</li>
        </ul>
      </LegalSection>

      <LegalSection {...SEC.liability}>
        <ul>
          <li>
            המידע באתר נועד לעזור לכם לבחור, והוא לא ייעוץ. ההחלטה אם לקנות, מה וממי, היא שלכם.
          </li>
          <li>
            אנחנו לא צד לעסקה בינכם לבין אלי אקספרס או המוכר, ולא אחראים למוצר, לאיכותו, להתאמתו
            לתיאור, לבטיחותו, למשלוח, למסים ולמכס, לאחריות או להחזרות.
          </li>
          <li>
            ככל שהדין מתיר, אנחנו לא אחראים לנזק שנגרם מהסתמכות על מידע שמקורו באלי אקספרס או
            במוכרים, מטעות של מודל השפה, או מתקלה או הפסקה בשירות.
          </li>
          <li>
            שום דבר בתקנון לא גורע מזכויות שאי אפשר לוותר עליהן לפי דין, כולל לפי חוק הגנת הצרכן,
            התשמ״א־1981.
          </li>
        </ul>
      </LegalSection>

      <LegalSection {...SEC.links}>
        <p>
          באתר יש קישורים לאתרים של אחרים, בעיקר אלי אקספרס, וגם וואטסאפ (לשיתוף עמודים). אין לנו
          שליטה עליהם, והשימוש בהם כפוף לתנאים ולמדיניות הפרטיות שלהם.
        </p>
      </LegalSection>

      <LegalSection {...SEC.changes}>
        <p>
          אנחנו עשויים לעדכן את התקנון. הנוסח המעודכן יפורסם בעמוד הזה, והתאריך בראש העמוד יתעדכן.
          המשך השימוש באתר אחרי העדכון הוא הסכמה לנוסח המעודכן.
        </p>
      </LegalSection>

      <LegalSection {...SEC.law}>
        <p>
          על התקנון ועל השימוש באתר חלים דיני מדינת ישראל. סמכות השיפוט הבלעדית בכל עניין הקשור בהם
          נתונה לבתי המשפט המוסמכים בישראל.
        </p>
      </LegalSection>

      <LegalSection {...SEC.contact}>
        <p>
          שאלות, בקשות ותלונות: <ContactEmail />. בנושאי פרטיות ראו את{" "}
          <Link href={LEGAL_PATHS.privacy}>מדיניות הפרטיות</Link>, ובנושאי נגישות את{" "}
          <Link href={LEGAL_PATHS.accessibility}>הצהרת הנגישות</Link>.
        </p>
      </LegalSection>
    </StaticPage>
  );
}
