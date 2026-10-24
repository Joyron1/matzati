"use client";

// A new scheduled Reel (owner request 2026-10-24): the video goes straight from the browser (or the
// phone) to the private bucket through a signed upload URL (never through Vercel, whose request
// limit is 4.5 MB), then the form is sent with its path, the caption, the networks and the time.
import { createClient } from "@supabase/supabase-js";
import { CalendarClock, Upload, Video } from "lucide-react";
import { useId, useState } from "react";
import { btnBusy, btnMd, btnPrimary, btnSecondary } from "@/components/styles";
import { inputClass } from "../settings/form-parts";
import { reelUploadAction, scheduleReelAction } from "./actions";

/** The bucket's limit (the Supabase free plan's most for one file). */
const MAX_BYTES = 50 * 1024 * 1024;
const TYPES = ["video/mp4", "video/quicktime"];

export function ReelForm({ defaultWhen, minWhen }: { defaultWhen: string; minWhen: string }) {
  const ids = { video: useId(), caption: useId(), when: useId() };
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captionLength, setCaptionLength] = useState(0);

  async function upload(file: File) {
    setError(null);
    if (!TYPES.includes(file.type)) return setError("רק קובץ MP4 או MOV.");
    if (file.size > MAX_BYTES) {
      return setError(
        `הקובץ ${(file.size / 1024 / 1024).toFixed(0)}MB, והמקסימום 50MB. כווצו אותו (למשל ייצוא ב־1080p) ונסו שוב.`,
      );
    }
    setBusy(true);
    try {
      const signed = await reelUploadAction();
      if (!signed) throw new Error("no upload url");
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { error: upError } = await supabase.storage
        .from("agent-media")
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: "video/mp4" });
      if (upError) throw upError;
      setPath(signed.path);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
    } catch {
      setError("ההעלאה נכשלה. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={scheduleReelAction} className="space-y-5">
      <div className="space-y-2">
        <p className="font-semibold">1. הסרטון</p>
        <div className="flex flex-wrap items-start gap-4">
          {preview && (
            <video
              src={preview}
              controls
              playsInline
              preload="metadata"
              className="h-56 rounded-xl border border-line bg-black"
            />
          )}
          <div className="space-y-1.5">
            <label
              htmlFor={ids.video}
              aria-disabled={busy}
              className={`${btnSecondary} ${btnMd} ${btnBusy} cursor-pointer gap-2`}
            >
              {path ? (
                <Video aria-hidden className="size-[18px]" />
              ) : (
                <Upload aria-hidden className="size-[18px]" />
              )}
              {busy ? "מעלה…" : path ? "החלפת הסרטון" : "בחירת סרטון"}
            </label>
            <input
              id={ids.video}
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
            <p className="text-xs text-muted">
              MP4 או MOV עד 50MB, אנכי 9:16 (1080×1920), 3 עד 90 שניות.
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm font-semibold text-ink">
            {error}
          </p>
        )}
        <input type="hidden" name="videoPath" value={path ?? ""} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={ids.caption} className="font-semibold">
          2. הכיתוב
        </label>
        <textarea
          id={ids.caption}
          name="caption"
          rows={7}
          maxLength={2100}
          required
          onChange={(e) => setCaptionLength(e.target.value.length)}
          className={`${inputClass} leading-relaxed`}
        />
        <p className="text-xs text-muted">
          <bdi dir="ltr">{captionLength}</bdi>/2100. באינסטגרם קישור בכיתוב לא לחיץ: כתבו ״הקישור
          בפרופיל״.
        </p>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="disclosure"
            defaultChecked
            className="size-5 accent-[var(--accent)]"
          />
          להוסיף בסוף את גילוי השותפים (כשהרילז מקדם מוצר מאלי אקספרס)
        </label>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="font-semibold">3. איפה לפרסם</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="instagram"
              defaultChecked
              className="size-5 accent-[var(--accent)]"
            />
            אינסטגרם
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="facebook"
              defaultChecked
              className="size-5 accent-[var(--accent)]"
            />
            פייסבוק
          </label>
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor={ids.when} className="font-semibold">
          4. מתי (שעון ישראל)
        </label>
        <input
          id={ids.when}
          type="datetime-local"
          name="when"
          required
          defaultValue={defaultWhen}
          min={minWhen}
          className={`${inputClass} max-w-xs`}
        />
        <p className="text-xs text-muted">
          לפחות 20 דקות מעכשיו, לא בשישי מ־17:00 עד שבת 19:30. הרילז מוכן אצל Meta עד שעה לפני,
          ועולה בזמן.
        </p>
      </div>

      <button
        type="submit"
        aria-disabled={busy || !path}
        disabled={!path}
        className={`${btnPrimary} ${btnMd} ${btnBusy} gap-2`}
      >
        <CalendarClock aria-hidden className="size-[18px]" />
        תזמון הרילז
      </button>
    </form>
  );
}
