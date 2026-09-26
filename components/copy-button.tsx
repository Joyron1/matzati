"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the code stays visible for manual copying.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-11 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-bg hover:opacity-90"
    >
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{copied ? "הועתק" : "העתקה"}</span>
    </button>
  );
}
