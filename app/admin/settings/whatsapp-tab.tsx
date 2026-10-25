// /admin/settings?tab=whatsapp (2026-10-25): whether the bot is on, the phone number id it answers
// for (to compare with Meta's dashboard), and what happened to the webhook's last calls
// (lib/whatsapp/diag.ts), each with what to fix. Never a secret: the number id is Meta's public id.
import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { card } from "@/components/styles";
import { formatDateTime } from "@/lib/format";
import { readDiag, type DiagEvent } from "@/lib/whatsapp/diag";
import { whatsappConfig, whatsappEnabled } from "@/lib/whatsapp/config";

const EXPLAIN: Record<DiagEvent["kind"], { tone: "ok" | "bad" | "info"; text: string }> = {
  received: { tone: "ok", text: "הודעה הגיעה והועברה לבוט." },
  no_messages: {
    tone: "info",
    text: "Meta שלחה עדכון בלי הודעה חדשה (למשל אישור שהודעה של הבוט נמסרה). תקין.",
  },
  other_number: {
    tone: "bad",
    text: "Meta שלחה הודעה למספר אחר מזה שהבוט מוגדר אליו. ב־Vercel, WHATSAPP_PHONE_NUMBER_ID צריך להיות ה־Phone number ID שמופיע כאן (מ־Meta), ואחרי השינוי צריך Redeploy.",
  },
  bad_signature: {
    tone: "bad",
    text: "הגיעה פנייה עם חתימה לא תקינה. כנראה WHATSAPP_APP_SECRET ב־Vercel לא תואם ל־App Secret של האפליקציה ב־Meta (App settings → Basic → App secret). אחרי התיקון צריך Redeploy.",
  },
  send_error: {
    tone: "bad",
    text: "Meta סירבה לשלוח את תשובת הבוט. ההודעה של Meta מופיעה כאן: לרוב טוקן שפג (צריך טוקן קבוע של System User), או מספר שלא אושר במצב בדיקות.",
  },
};

export async function WhatsAppTab() {
  const enabled = whatsappEnabled();
  const numberId = enabled ? whatsappConfig().phoneNumberId : null;
  const events = await readDiag().catch(() => [] as DiagEvent[]);
  return (
    <div className="space-y-6">
      <section className={`${card} space-y-3 p-5 sm:p-6`}>
        <h2 className="text-lg font-bold">הבוט בוואטסאפ</h2>
        <p className="flex items-center gap-2">
          {enabled ? (
            <CheckCircle2 aria-hidden className="size-5 text-trust" />
          ) : (
            <CircleDashed aria-hidden className="size-5 text-muted" />
          )}
          {enabled ? "המפתחות מוגדרים ב־Vercel, והבוט פעיל." : "המפתחות לא מוגדרים: הבוט כבוי."}
        </p>
        {numberId && (
          <p className="text-sm">
            הבוט עונה ל־Phone number ID:{" "}
            <bdi dir="ltr" className="font-mono font-semibold">
              {numberId}
            </bdi>
            . ב־Meta (WhatsApp → API Setup) המספר שאליו כותבים צריך להראות את אותו מזהה.
          </p>
        )}
      </section>

      <section className={`${card} space-y-3 p-5 sm:p-6`}>
        <h2 className="text-lg font-bold">מה הגיע לאחרונה מ־Meta</h2>
        {!events.length ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold">
              לא הגיעה אף פנייה מ־Meta מאז שהבדיקה הזו הותקנה. אם כתבתם לבוט, Meta לא שולחת אלינו את
              ההודעות. בדקו ב־Meta for Developers:
            </p>
            <ol className="list-decimal space-y-1 ps-5">
              <li>
                WhatsApp → Configuration → Webhook: ה־Callback URL הוא{" "}
                <bdi dir="ltr" className="font-mono">
                  https://www.matzati-il.com/api/whatsapp/webhook
                </bdi>{" "}
                והוא מאומת (Verified).
              </li>
              <li>באותו מסך, ב־Webhook fields, השדה messages מסומן (Subscribed).</li>
              <li>
                אם האפליקציה במצב Development: רק מספרים שנוספו כנמענים לבדיקה יכולים לכתוב לבוט.
                להפעלה לכולם צריך להעביר אותה ל־Live.
              </li>
              <li>
                המספר שאליו כותבים הוא המספר שמחובר ל־API (לא אפליקציית WhatsApp Business רגילה על
                אותו מספר).
              </li>
            </ol>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e, i) => {
              const x = EXPLAIN[e.kind];
              const Icon =
                x.tone === "ok" ? CheckCircle2 : x.tone === "bad" ? CircleAlert : CircleDashed;
              return (
                <li key={i} className="flex items-start gap-2 py-3 text-sm">
                  <Icon
                    aria-hidden
                    className={`mt-0.5 size-5 shrink-0 ${
                      x.tone === "ok"
                        ? "text-trust"
                        : x.tone === "bad"
                          ? "text-accent"
                          : "text-muted"
                    }`}
                  />
                  <div className="space-y-1">
                    <p>
                      <span className="font-semibold">{formatDateTime(e.at)}</span> · {x.text}
                    </p>
                    {e.numberIds?.length ? (
                      <p className="text-muted">
                        Phone number ID בפנייה:{" "}
                        <bdi dir="ltr" className="font-mono">
                          {e.numberIds.join(", ")}
                        </bdi>
                      </p>
                    ) : null}
                    {e.error && (
                      <p className="text-muted">
                        <bdi dir="ltr" className="font-mono">
                          {e.error}
                        </bdi>
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
