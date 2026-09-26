import type { Metadata } from "next";
import { StaticPage } from "@/components/static-page";
import { BRAND } from "@/lib/config/brand";
import { FILTERS } from "@/lib/ranking/config";

export const metadata: Metadata = { title: "גילוי נאות" };

export default function DisclosurePage() {
  return (
    <StaticPage title="גילוי נאות">
      <p>
        {BRAND.name} משתתף בתוכנית השותפים של אלי אקספרס. כשאתם קונים דרך קישור באתר, אלי אקספרס
        משלמת לנו עמלה קטנה. המחיר שלכם לא משתנה בגלל זה.
      </p>
      <h2>איך נקבע סדר התוצאות</h2>
      <ul>
        <li>
          אנחנו מסננים מוצרים לפי משוב חיובי של קונים ({FILTERS.minPositiveFeedbackPct}% ומעלה),
          מספר מכירות ({FILTERS.minUnitsSold} ומעלה) והתאמה לתקציב שכתבתם.
        </li>
        <li>
          גובה העמלה לא משפיע על הדירוג. הוא משמש רק כדי להכריע בין שני מוצרים שקיבלו בדיוק את אותו
          ציון.
        </li>
        <li>כל המחירים והמספרים מגיעים מאלי אקספרס. אנחנו לא ממציאים נתונים.</li>
        <li>מחירים שהומרו מדולר מסומנים ב־≈. המחיר הסופי מוצג באלי אקספרס.</li>
      </ul>
      <h2>על AI באתר</h2>
      <p>
        מודל שפה עוזר לנו להבין את החיפוש שכתבתם ולנסח משפט קצר על כל מוצר, רק מתוך הנתונים שקיבלנו
        מאלי אקספרס. החיפוש, הסינון והדירוג נעשים בקוד קבוע ולא על ידי המודל.
      </p>
      <h2>מי אנחנו</h2>
      <p>[PLACEHOLDER: שם העסק או בעל האתר, מספר עוסק, דרך ליצירת קשר]</p>
    </StaticPage>
  );
}
