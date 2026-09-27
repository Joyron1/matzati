import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/static-page";
import { BRAND } from "@/lib/config/brand";

export const metadata: Metadata = { title: "מדיניות פרטיות" };

export default function PrivacyPage() {
  return (
    <StaticPage title="מדיניות פרטיות">
      <p>[PLACEHOLDER: טיוטה לבדיקה משפטית. הסעיפים הבאים מתארים איך {BRAND.name} בנוי כרגע.]</p>
      <h2>מה אנחנו שומרים</h2>
      <ul>
        <li>טקסט החיפוש, הסינונים שהבנו ממנו ומזהי המוצרים שהוצגו, בלי פרטים על מי שחיפש.</li>
        <li>
          חיפושים שמצאו מוצרים מוצגים לכל הגולשים בעמוד{" "}
          <Link href="/searches" className="underline underline-offset-4 hover:text-accent-ink">
            חיפושים אחרונים
          </Link>
          , בלי פרטים על מי שחיפש. חיפוש שיש בו מספר טלפון, אימייל או קישור לא מוצג שם אף פעם,
          וחיפושים לא ראויים מוסתרים. אל תכתבו בחיפוש פרטים אישיים.
        </li>
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
