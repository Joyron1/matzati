// The /privacy section about the newsletter (the footer's sign-up for email updates on deals and
// coupons). Every statement must stay true of the code: lib/newsletter/ (what a sign-up stores,
// the consent text and version, the per-IP limit on a salted hash), the unsubscribe page
// (app/newsletter/unsubscribe), supabase/migrations/20260929000000_newsletter.sql (the columns, no
// IP, a row kept with unsubscribed_at after an opt-out, no automatic deletion), /admin/newsletter
// (admins read it and export a CSV; nothing sends email yet, and no email provider receives the
// addresses). Change this text when any of that changes.
import { ContactEmail } from "@/components/static-page";
import { RETENTION } from "@/lib/config/legal";
import { NEWSLETTER_CONSENT_TEXT } from "@/lib/newsletter/consent";
import { NEWSLETTER_SIGNUPS_PER_DAY } from "@/lib/newsletter/rate-limit";

/** The section's id is what the footer form and the unsubscribe page link to (#newsletter). */
export const NEWSLETTER_PRIVACY_SECTION = {
  id: "newsletter",
  title: "עדכונים באימייל על מבצעים וקופונים",
} as const;

export function NewsletterPrivacy() {
  return (
    <>
      <p>
        בתחתית כל עמוד אפשר להירשם לעדכונים באימייל על מבצעים וקופונים. ההרשמה היא בחירה שלכם,
        והשימוש באתר לא תלוי בה.
      </p>

      <h3>מה נשמר</h3>
      <ul>
        <li>כתובת האימייל שכתבתם.</li>
        <li>
          הנוסח של תיבת ההסכמה שסימנתם, הגרסה שלו ומועד ההסכמה. הנוסח היום:{" "}
          <q>{NEWSLETTER_CONSENT_TEXT}</q>
        </li>
        <li>איפה נרשמתם (למשל בטופס שבתחתית העמוד) ומתי נוצרה הרשומה.</li>
        <li>קוד אקראי שמופיע בקישור ההסרה, כדי שאפשר יהיה להסיר את ההרשמה בלי להתחבר.</li>
        <li>אם הסרתם את ההרשמה: מועד ההסרה.</li>
      </ul>
      <p>
        עם ההרשמה לא נשמרים שם, טלפון או כתובת IP. כדי למנוע הרשמות אוטומטיות אנחנו מגבילים את
        ההרשמות ל־{NEWSLETTER_SIGNUPS_PER_DAY} ביום מכל כתובת IP, וסופרים אותן באותה שיטה של מגבלת
        החיפושים: לפי ערך מגובב (hash) חד־כיווני של הכתובת, שנמחק {RETENTION.rateLimitHours} שעות
        אחרי סוף היום.
      </p>

      <h3>למה, ועל מה זה מבוסס</h3>
      <p>
        כדי לשלוח לכם עדכונים על מבצעים וקופונים, ולתעד שהסכמתם לקבל אותם. הבסיס הוא ההסכמה המפורשת
        שלכם, שחוק התקשורת (בזק ושידורים), התשמ״ב־1982, מחייב לפני שליחת הודעות פרסומת. אפשר לבטל
        אותה בכל עת.
      </p>

      <h3>מי מעבד את המידע</h3>
      <p>
        הרשומות נשמרות במסד הנתונים שלנו ב־Supabase, באזור פרנקפורט, גרמניה, ורק מנהלי האתר רואים
        אותן. הטופס נשלח דרך Vercel, כמו כל בקשה לאתר. כתובות האימייל לא מועברות היום לאף ספק של
        שליחת אימייל. לפני שנעביר אותן לספק כזה, נעדכן כאן מי הוא ואיפה הוא מעבד את המידע.
      </p>

      <h3>איך מסירים את ההרשמה</h3>
      <p>
        בכל הודעה שנשלח יהיה קישור להסרה: פותחים אותו ומאשרים בלחיצה, בלי להתחבר. אפשר גם לכתוב לנו
        ל־
        <ContactEmail />, ונסיר אתכם.
      </p>

      <h3>כמה זמן זה נשמר</h3>
      <p>
        כל עוד אתם רשומים. אחרי הסרה אנחנו לא מוחקים את הרשומה: מסמנים בה את מועד ההסרה, ולא שולחים
        אליה יותר. היא נשארת כתיעוד של ההסכמה שנתתם ושל הביטול שלה, כדי שנוכל להראות שכיבדנו אותו.
        אם תרצו שנמחק גם אותה, כתבו לנו ונמחק. אם תירשמו שוב, הרשומה תתעדכן בהסכמה החדשה ובמועד שלה.
      </p>
    </>
  );
}
