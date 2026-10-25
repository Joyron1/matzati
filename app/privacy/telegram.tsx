// The /privacy section about the Telegram search group (owner request 2026-10-25), shown only while
// the bot is configured (telegramConfig: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set). Every
// statement must stay true of the code: lib/telegram/group/ (handle.ts: what is read, answered and
// deleted; server.ts: the member's salted hash for the daily counters, the search with typed:false,
// classify.ts: the model sees the message text only). Change this text when any of that changes.
import { RETENTION } from "@/lib/config/legal";

export const TELEGRAM_PRIVACY_SECTION = {
  id: "telegram",
  title: "קבוצת החיפושים בטלגרם",
} as const;

export function TelegramPrivacy() {
  return (
    <>
      <p>
        בקבוצת החיפושים שלנו בטלגרם אפשר לכתוב מה מחפשים, והבוט שלנו עונה בקבוצה עם מוצרים שעברו את
        הסינון. ההודעות בקבוצה גלויות לכל חברי הקבוצה, כמו בכל קבוצת טלגרם.
      </p>

      <h3>מה קורה כשאתם כותבים בקבוצה</h3>
      <ul>
        <li>
          טלגרם מעבירה לבוט את ההודעה ואת המזהה שלכם בטלגרם. כדי להחליט אם ההודעה היא חיפוש מוצר,
          אנחנו שולחים את הטקסט שלה בלבד (בלי שם או מזהה) למודל שפה (Anthropic). הודעה שאינה חיפוש
          נמחקת מהקבוצה אחרי כמה שניות.
        </li>
        <li>
          חיפוש נשמר כמו כל חיפוש באתר, כפי שמתואר בסעיף על החיפושים: הטקסט, מה שהבנו ממנו והתוצאות,
          בלי פרטים עליכם. חיפוש מהקבוצה לא מוצג בעמוד ״חיפושים אחרונים״ באתר.
        </li>
        <li>
          מונה החיפושים היומי שלכם נשמר תחת ערך מגובב (hash) חד־כיווני של המזהה בטלגרם עם ערך סודי,
          ולא תחת המזהה עצמו, ונמחק {RETENTION.rateLimitHours} שעות אחרי סוף היום.
        </li>
      </ul>
      <p>אנחנו לא שומרים אצלנו את המזהה שלכם בטלגרם, את השם או היסטוריה של ההודעות.</p>

      <h3>מי מעבד את המידע</h3>
      <p>
        ההודעות עוברות דרך טלגרם, שמעבדת ושומרת אותן לפי התנאים והמדיניות שלה. הקוד שלנו רץ ב־Vercel
        והמידע שמתואר כאן נשמר ב־Supabase, כמו שמפורט בסעיף ״עם מי המידע משותף״.
      </p>

      <h3>סקרים בערוץ</h3>
      <p>
        בערוץ שלנו נשלח מדי פעם סקר אנונימי על הקטגוריות שמעניינות אתכם. בסקר אנונימי טלגרם מעבירה
        אלינו רק את מספר הקולות לכל תשובה, לא מי הצביע.
      </p>
    </>
  );
}
