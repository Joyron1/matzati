"use client";

import Link from "next/link";
import { btnMd, btnPrimary, btnSecondary } from "@/components/styles";

// Last-resort error page for unexpected render errors. Server code already maps known failures
// to Hebrew states; this only keeps users off Next's generic English page.
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 pt-20 text-center">
      <h1 className="font-display text-4xl">משהו השתבש</h1>
      <p className="text-lg text-muted">קרתה תקלה זמנית. נסו שוב בעוד רגע.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={`${btnPrimary} ${btnMd}`}>
          ניסיון נוסף
        </button>
        <Link href="/" className={`${btnSecondary} ${btnMd}`}>
          לעמוד הבית
        </Link>
      </div>
    </div>
  );
}
