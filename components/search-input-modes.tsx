"use client";

import { Camera, ImageUp, Link2, Loader2, Search, Type } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { searchHref } from "@/lib/search-url";
import { btnBusy, btnLg, btnMd, btnPrimary, btnSecondary } from "./styles";

/** How the visitor searches (owner request 2026-10-23): words, a product link, or a photo. */
export type InputMode = "text" | "link" | "image";

const TABS: { mode: InputMode; label: string; Icon: typeof Type }[] = [
  { mode: "text", label: "טקסט", Icon: Type },
  { mode: "link", label: "קישור", Icon: Link2 },
  { mode: "image", label: "תמונה", Icon: Camera },
];

/** A link someone pasted into the words field: the composer switches to the link tab. */
export function looksLikeLink(text: string): boolean {
  return /^\s*https?:\/\/\S+\s*$/i.test(text);
}

/** The three tabs above the field: a real tablist, arrows move between them. */
export function ModeTabs({
  value,
  onChange,
  compact = false,
}: {
  value: InputMode;
  onChange: (mode: InputMode) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="איך לחפש"
      className="inline-flex rounded-full bg-surface-2 p-1"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const i = TABS.findIndex((t) => t.mode === value);
        // RTL: ArrowLeft goes forward.
        const next = (i + (e.key === "ArrowLeft" ? 1 : -1) + TABS.length) % TABS.length;
        onChange(TABS[next].mode);
        e.preventDefault();
      }}
    >
      {TABS.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          role="tab"
          aria-selected={value === mode}
          tabIndex={value === mode ? 0 : -1}
          onClick={() => onChange(mode)}
          className={`inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors motion-reduce:transition-none ${
            compact ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-[15px]"
          } ${value === mode ? "bg-surface text-accent-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

const ERRORS: Record<string, string> = {
  invalid: "הקישור או הקובץ לא תקינים. נסו שוב.",
  rate_limited: "הגעתם למגבלת החיפושים. נסו שוב מאוחר יותר.",
  capacity: "המערכת עמוסה כרגע. נסו שוב מאוחר יותר.",
  not_found: "לא הצלחנו לזהות מוצר. נסו תמונה ברורה יותר, או כתבו מה אתם מחפשים.",
  unreadable: "לא הצלחנו לקרוא את העמוד הזה. נסו להעלות צילום מסך שלו, או כתבו את שם המוצר.",
  unavailable: "משהו השתבש אצלנו. נסו שוב בעוד רגע.",
};

/** Asks the server for the query (or our product page) and opens it. */
function useFromInput() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/search/from-input", { method: "POST", ...init });
      const data = (await res.json().catch(() => ({}))) as {
        q?: string;
        mode?: "simple";
        cat?: string;
        productId?: string;
        error?: string;
      };
      if (data.productId) router.push(`/p/${encodeURIComponent(data.productId)}`);
      else if (data.q) router.push(searchHref({ q: data.q, mode: data.mode, cat: data.cat }));
      else {
        setError(ERRORS[data.error ?? "unavailable"] ?? ERRORS.unavailable);
        setBusy(false);
      }
    } catch {
      setError(ERRORS.unavailable);
      setBusy(false);
    }
  }
  return { busy, error, send };
}

/** A product link from any store: AliExpress opens our page, others become a search. */
export function LinkSearch({
  variant,
  initial = "",
}: {
  variant: "hero" | "bar";
  initial?: string;
}) {
  const inputId = useId();
  const [link, setLink] = useState(initial);
  const { busy, error, send } = useFromInput();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!busy && link.trim()) {
      void send({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link }),
      });
    }
  }

  return (
    <form onSubmit={submit} role="search" className="space-y-2">
      <label
        htmlFor={inputId}
        className={variant === "hero" ? "block px-1 text-lg font-bold" : "sr-only"}
      >
        הדביקו קישור למוצר
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="url"
          inputMode="url"
          required
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://… קישור מאמזון, שיין, טמו, KSP או אלי אקספרס"
          dir="ltr"
          className={`min-w-0 flex-1 rounded-2xl border-2 border-muted/70 bg-bg px-4 text-ink placeholder:text-muted hover:border-muted focus-visible:border-accent ${
            variant === "hero" ? "h-16 text-lg" : "h-12 text-base"
          }`}
        />
        <button
          type="submit"
          aria-disabled={busy}
          className={`${btnPrimary} ${variant === "hero" ? btnLg : btnMd} ${btnBusy}`}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-5 animate-spin" />
          ) : (
            <Search aria-hidden className="size-5" />
          )}
          {busy ? "קוראים את הקישור…" : "חיפוש לפי קישור"}
        </button>
      </div>
      <p className="px-1 text-sm text-muted">
        נזהה את המוצר מהקישור, מאלי אקספרס או מכל חנות אחרת, ונחפש לכם באלי אקספרס מוצרים זהים או
        דומים מאוד.
      </p>
      {error && (
        <p role="alert" className="px-1 text-sm font-semibold text-ink">
          {error}
        </p>
      )}
    </form>
  );
}

/** Downscales a photo in the browser (Vercel takes at most 4.5 MB per request): JPEG, 1024 px. */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85),
  );
}

/** A photo (upload, or the camera on a phone): the AI names the product and we search for it. */
export function ImageSearch({ variant }: { variant: "hero" | "bar" }) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const { busy, error, send } = useFromInput();

  async function pick(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) return setLocalError("רק קובץ תמונה.");
    try {
      const small = await downscale(file);
      setBlob(small);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(small);
      });
    } catch {
      setLocalError("לא הצלחנו לקרוא את התמונה. נסו קובץ אחר.");
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !blob) return;
    const form = new FormData();
    form.append("image", blob, "photo.jpg");
    void send({ body: form });
  }

  return (
    <form onSubmit={submit} role="search" className="space-y-2">
      <p className={variant === "hero" ? "px-1 text-lg font-bold" : "sr-only"}>חיפוש לפי תמונה</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label
          htmlFor={inputId}
          className={`flex flex-1 cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-muted/70 bg-bg px-4 hover:border-accent ${
            variant === "hero" ? "min-h-20 py-3" : "min-h-12 py-1.5"
          }`}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote image
            <img src={preview} alt="התמונה שבחרתם" className="size-14 rounded-xl object-cover" />
          ) : (
            <ImageUp aria-hidden className="size-7 text-muted" />
          )}
          <span className="text-[15px] text-muted">
            {preview ? "החלפת התמונה" : "בחרו תמונה או צלמו מוצר"}
          </span>
        </label>
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <button
          type="submit"
          aria-disabled={busy || !blob}
          className={`${blob ? btnPrimary : btnSecondary} ${variant === "hero" ? btnLg : btnMd} ${btnBusy}`}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-5 animate-spin" />
          ) : (
            <Search aria-hidden className="size-5" />
          )}
          {busy ? "מזהים את המוצר…" : "חיפוש לפי התמונה"}
        </button>
      </div>
      <p className="px-1 text-sm text-muted">
        ה־AI מזהה את המוצר ומחפש את אותו מוצר באלי אקספרס. התמונה לא נשמרת.
      </p>
      {(localError ?? error) && (
        <p role="alert" className="px-1 text-sm font-semibold text-ink">
          {localError ?? error}
        </p>
      )}
    </form>
  );
}
