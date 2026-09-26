import Link from "next/link";
import { btnMd, btnPrimary } from "@/components/styles";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 pt-20 text-center">
      <h1 className="font-display text-4xl">לא מצאנו את הדף הזה</h1>
      <p className="text-lg text-muted">ייתכן שהקישור ישן או שהמוצר כבר לא זמין.</p>
      <Link href="/" className={`${btnPrimary} ${btnMd}`}>
        לחיפוש חדש
      </Link>
    </div>
  );
}
