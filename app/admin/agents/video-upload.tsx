"use client";

import { createClient } from "@supabase/supabase-js";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { btnBusy, btnMd, btnSecondary } from "@/components/styles";
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

  async function upload(file: File) {
    setError(null);
    if (!TYPES.includes(file.type)) return setError("רק קובץ MP4 או MOV.");
    if (file.size > MAX_BYTES) return setError("הקובץ גדול מ־20MB. כווצו אותו ונסו שוב.");
    setBusy(true);
    try {
      const signed = await videoUploadAction(candidateId);
      if (!signed) throw new Error("no upload url");
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { error: upError } = await supabase.storage
        .from("agent-media")
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
      if (upError) throw upError;
      if (!(await videoAttachAction(candidateId, signed.path))) throw new Error("attach");
      router.refresh();
    } catch {
      setError("ההעלאה נכשלה. נסו שוב.");
    } finally {
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
      {error && (
        <p role="alert" className="text-sm font-semibold text-ink">
          {error}
        </p>
      )}
    </div>
  );
}
