import type { Metadata } from "next";
import { StaticPage } from "@/components/static-page";
import { BRAND } from "@/lib/config/brand";

export const metadata: Metadata = { title: "תנאי שימוש" };

export default function TermsPage() {
  return (
    <StaticPage title="תנאי שימוש">
      <p>[PLACEHOLDER: טיוטה לבדיקה משפטית.]</p>
      <h2>מה השירות עושה</h2>
      <p>
        {BRAND.name} עוזר למצוא מוצרים באלי אקספרס. אנחנו לא מוכרים מוצרים, לא מחזיקים מלאי ולא
        אחראים למשלוח, לאחריות או להחזרות. הקנייה עצמה מתבצעת מול אלי אקספרס והמוכר.
      </p>
      <h2>מחירים וזמינות</h2>
      <p>
        מחירים, מלאי ונתוני מכירות משתנים כל הזמן. המחיר הקובע הוא המחיר שמוצג באלי אקספרס בזמן
        הקנייה.
      </p>
      <h2>הגבלת אחריות</h2>
      <p>[PLACEHOLDER: סעיף הגבלת אחריות]</p>
      <h2>דין ושיפוט</h2>
      <p>[PLACEHOLDER: דין חל ומקום שיפוט]</p>
    </StaticPage>
  );
}
