// The /privacy section about the WhatsApp bot, shown only while the bot is on (whatsappEnabled:
// the four WHATSAPP_* secrets are set), so the page is true exactly when the bot is live. Every
// statement must stay true of the code: lib/whatsapp/ (what the bot stores: session.ts, the
// search it runs: bot.ts with typed:false so it is never listed on /searches, no message is sent
// unless the user wrote first), supabase/migrations/20260929120000_whatsapp.sql (the two tables and
// their 48-hour deletion), RETENTION.whatsappHours. Change this text when any of that changes.
// A draft for the owner to review before the bot goes live.
import { ContactEmail } from "@/components/static-page";
import { RETENTION } from "@/lib/config/legal";

export const WHATSAPP_PRIVACY_SECTION = {
  id: "whatsapp",
  title: "הבוט שלנו בוואטסאפ",
} as const;

export function WhatsAppPrivacy() {
  return (
    <>
      <p>
        אפשר לחפש מוצרים גם בשיחת וואטסאפ עם המספר של האתר. השימוש בבוט הוא בחירה שלכם, ואנחנו
        כותבים לכם רק בתגובה להודעה שכתבתם לנו.
      </p>

      <h3>מה קורה כשאתם כותבים לנו</h3>
      <p>
        וואטסאפ (חברת Meta) מעבירה אלינו את ההודעה שכתבתם ואת מספר הוואטסאפ שלכם, כדי שנוכל לענות.
        החיפוש עצמו נשמר כמו כל חיפוש באתר, כפי שמתואר בסעיף על החיפושים: הטקסט, מה שהבנו ממנו
        והתוצאות, בלי מספר הטלפון. חיפוש מהבוט לא מוצג בעמוד ״חיפושים אחרונים״.
      </p>

      <h3>מה נשמר על השיחה</h3>
      <ul>
        <li>
          החיפוש האחרון שלכם והבחירות שלכם בו (סינונים שהסרתם, מיון), כדי ש״עוד אפשרויות״ והכפתורים
          יעבדו. הוא נשמר תחת ערך מגובב (hash) חד־כיווני של מספר הוואטסאפ עם ערך סודי, ולא תחת המספר
          עצמו, ונמחק {RETENTION.whatsappHours} שעות אחרי הפעולה האחרונה שלכם בשיחה.
        </li>
        <li>
          מזהי ההודעות שטיפלנו בהן, כדי לא לענות פעמיים על אותה הודעה: נמחקים אחרי{" "}
          {RETENTION.whatsappHours} שעות.
        </li>
        <li>
          מונה הגבלת החיפושים, לפי אותו ערך מגובב, באותה שיטה של מגבלת החיפושים באתר (נמחק{" "}
          {RETENTION.rateLimitHours} שעות אחרי סוף החלון שלו).
        </li>
      </ul>
      <p>אנחנו לא שומרים אצלנו את מספר הטלפון עצמו, את השם בפרופיל שלכם או היסטוריה של ההודעות.</p>

      <h3>מי מעבד את המידע</h3>
      <p>
        ההודעות והמספר עוברים דרך פלטפורמת WhatsApp Business של Meta, שמעבדת ושומרת אותם לפי התנאים
        והמדיניות שלה, שאנחנו לא שולטים בהם. הקוד שלנו רץ ב־Vercel והמידע שמתואר כאן נשמר
        ב־Supabase, כמו שמפורט בסעיף ״עם מי המידע משותף״.
      </p>

      <h3>איך מפסיקים ומוחקים</h3>
      <p>
        כתבו בשיחה <q>עצור</q> ונמחק מהמערכת שלנו את החיפוש האחרון שלכם. אנחנו לא שולחים הודעות
        מיוזמתנו, ולכן אין צורך לבטל הרשמה. אפשר גם לחסום את המספר בוואטסאפ, או לכתוב לנו ל־
        <ContactEmail />.
      </p>
    </>
  );
}
