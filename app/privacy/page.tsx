import type { Metadata } from "next";
import { StaticPage } from "@/components/static-page";
import { BRAND } from "@/lib/config/brand";

export const metadata: Metadata = { title: "מדיניות פרטיות" };

export default function PrivacyPage() {
  return (
    <StaticPage title="מדיניות פרטיות">
      <p>[PLACEHOLDER: טיוטה לבדיקה משפטית. הסעיפים הבאים מתארים איך {BRAND.name} בנוי כרגע.]</p>
      <h2>מה אנחנו שומרים</h2>
      <ul>
        <li>טקסט החיפוש, הסינונים שהבנו ממנו ומזהי המוצרים שהוצגו, בלי שום פרט מזהה.</li>
        <li>לחיצות על כפתורי קנייה: מזהה המוצר, מאיזה עמוד הגיעה הלחיצה והשעה.</li>
        <li>
          כדי למנוע שימוש לרעה אנחנו סופרים חיפושים לפי גרסה מוצפנת חד־כיוונית של כתובת ה־IP. את
          הכתובת עצמה אנחנו לא שומרים.
        </li>
      </ul>
      <h2>צדדים שלישיים</h2>
      <ul>
        <li>אלי אקספרס: כשאתם עוברים לאתר שלהם, חלה מדיניות הפרטיות שלהם.</li>
        <li>ספק מודל השפה: מקבל את טקסט החיפוש בלבד, כדי להבין אותו.</li>
        <li>[PLACEHOLDER: ספקי אחסון ואנליטיקה, אם יתווספו]</li>
      </ul>
      <h2>יצירת קשר</h2>
      <p>[PLACEHOLDER: כתובת אימייל לפניות בנושא פרטיות]</p>
    </StaticPage>
  );
}
