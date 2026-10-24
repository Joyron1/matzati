"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { btnBusy, btnMd, btnSecondary } from "@/components/styles";
import { ProgressBar } from "../progress";
import { uploadToSignedUrl } from "../upload";
import { videoAttachAction, videoUploadAction } from "./actions";

/** Telegram's limit for a video it fetches by URL, and the bucket's limit. */
const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = ["video/mp4", "video/quicktime"];

/**
 * The owner's motion video for a product (owner request 2026-10-23): straight from the browser to
 * the private bucket agent-media through a signed upload URL the server makes (never through
 * Vercel, whose request body limit is 4.5 MB), then recorded on the candidate. MP4 or MOV, 20 MB
 * at most (Telegram's limit for a video sent by URL).
 */
export function VideoUpload({ candidateId, hasVideo }: { candidateId: string; hasVideo: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  async function upload(file: File) {
    setError(null);
    if (!TYPES.includes(file.type)) return setError("רק קובץ MP4 או MOV.");
    if (file.size > MAX_BYTES) return setError("הקובץ גדול מ־20MB. כווצו אותו ונסו שוב.");
    setBusy(true);
    setDone(false);
    setPct(0);
    try {
      const signed = await videoUploadAction(candidateId);
      if (!signed) throw new Error("no upload url");
      await uploadToSignedUrl("agent-media", signed, file, file.type, (x) => setPct(x * 95));
      if (!(await videoAttachAction(candidateId, signed.path))) throw new Error("attach");
      setPct(100);
      setDone(true);
      router.refresh();
    } catch {
      setError("ההעלאה נכשלה. נסו שוב.");
    } finally {
      setPct(null);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className={`${btnSecondary} ${btnMd} ${btnBusy} cursor-pointer`}
        aria-disabled={busy}
      >
        <Upload aria-hidden className="size-[18px]" />
        {busy ? "מעלה…" : hasVideo ? "החלפת הסרטון" : "העלאת סרטון לפרסום"}
      </label>
      <input
        id={inputId}
        type="file"
        accept="video/mp4,video/quicktime"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <p className="text-xs text-muted">MP4 או MOV, עד 20MB. בטלגרם יעלה הסרטון במקום התמונה.</p>
      {pct !== null && (
        <ProgressBar
          value={pct}
          label={pct < 95 ? "מעלים את הסרטון" : "שומרים את הסרטון למוצר"}
          detail={`${Math.round(pct)}%`}
        />
      )}
      {done && !busy && (
        <p role="status" className="text-sm font-semibold text-trust">
          הסרטון הועלה. בטלגרם יעלה הסרטון במקום התמונה.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-accent-ink">
          {error}
        </p>
      )}
    </div>
  );
}
