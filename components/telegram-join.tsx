// "מצאתי גם בטלגרם" on the home page (owner request 2026-10-27): two cards, the channel of
// recommended products and the search group where the bot answers a written search with its 5
// best matches (lib/telegram/group/). The links come from Telegram (lib/telegram/join-links.ts);
// a card without its link is left out, the section when both are. Server component.
import { Check } from "lucide-react";
import { joinButton, TelegramMark } from "./telegram-mark";
import { shortLived } from "@/lib/cache-lifetime";
import { telegramJoinLinks, type TelegramJoinLinks } from "@/lib/telegram/join-links";

function JoinCard({
  id,
  kind,
  title,
  body,
  points,
  preview,
  href,
  cta,
}: {
  id: string;
  kind: string;
  title: string;
  body: string;
  points: string[];
  preview: React.ReactNode;
  href: string;
  cta: string;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-tg-to to-tg text-white">
          <TelegramMark className="size-7" />
        </span>
        <div className="min-w-0 space-y-1">
          <span className="inline-flex rounded-full bg-tg-soft px-2.5 py-0.5 text-xs font-bold text-tg-ink">
            {kind}
          </span>
          <h3 id={id} className="text-xl font-bold text-ink">
            {title}
          </h3>
        </div>
      </div>
      <p className="leading-relaxed text-pretty text-muted">{body}</p>
      <div aria-hidden className="flex min-h-56 flex-col justify-center rounded-xl bg-tg-soft p-3">
        {preview}
      </div>
      <ul className="space-y-2">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2 text-[15px] text-ink">
            <Check aria-hidden className="mt-0.5 size-[18px] shrink-0 text-tg-ink" />
            {point}
          </li>
        ))}
      </ul>
      <a
        href={href}
        target="_blank"
        rel="noopener"
        aria-describedby={id}
        className={`${joinButton} mt-auto`}
      >
        <TelegramMark className="size-5" />
        {cta}
        <span className="sr-only">(נפתח בטלגרם)</span>
      </a>
    </li>
  );
}

/** A post of the channel, drawn: a photo, text lines and the buy line. */
export function ChannelPreview() {
  return (
    <div className="mx-auto w-full max-w-[17rem] rounded-2xl bg-surface p-2 shadow-soft">
      <div className="grid grid-cols-3 gap-1">
        <div className="col-span-2 row-span-2 aspect-square rounded-lg bg-surface-2" />
        <div className="aspect-square rounded-lg bg-surface-2" />
        <div className="aspect-square rounded-lg bg-surface-2" />
      </div>
      <div className="mt-2 space-y-1.5 px-1">
        <div className="h-2 w-4/5 rounded-full bg-line" />
        <div className="h-2 w-3/5 rounded-full bg-line" />
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="rounded-full bg-gold px-1.5 py-px text-[11px] font-bold text-on-gold">
            קוד הנחה
          </span>
          <span className="text-xs font-semibold text-tg-ink">לקנייה באלי אקספרס ←</span>
        </div>
      </div>
    </div>
  );
}

/** A search in the group, drawn: the member's message and the bot's 5 ranked results. */
export function GroupPreview() {
  const medals = ["bg-gold", "bg-muted/50", "bg-cta-to/70", "bg-line", "bg-line"];
  return (
    <div className="space-y-2">
      <p className="me-auto w-fit max-w-[85%] rounded-2xl rounded-ss-sm bg-tg px-3 py-2 text-sm font-medium text-white">
        אוזניות לריצה עמידות למים עד 100 ש״ח
      </p>
      <div className="ms-auto w-fit max-w-[90%] rounded-2xl rounded-se-sm bg-surface p-2 shadow-soft">
        <div className="grid grid-cols-3 gap-1">
          {medals.map((medal, i) => (
            <div key={i} className="relative aspect-square w-14 rounded-lg bg-surface-2 sm:w-16">
              <span
                className={`absolute start-1 top-1 grid size-4 place-items-center rounded-full text-[10px] font-bold text-ink ${medal}`}
              >
                {i + 1}
              </span>
            </div>
          ))}
          <div className="grid aspect-square w-14 place-items-center rounded-lg bg-tg-soft text-[10px] font-bold text-tg-ink sm:w-16">
            מצאתי
          </div>
        </div>
        <p className="mt-1.5 px-1 text-xs font-semibold text-ink">5 התוצאות הכי טובות שמצאנו</p>
      </div>
    </div>
  );
}

export async function TelegramJoin() {
  const links = await telegramJoinLinks();
  if (!links.channelUrl && !links.groupUrl) {
    // Hidden after a failure: try again in a minute rather than for the page's whole hour.
    await shortLived();
    return null;
  }
  return <TelegramJoinView links={links} />;
}

/** The section for given links (also the dev preview's). */
export function TelegramJoinView({ links }: { links: TelegramJoinLinks }) {
  const cards = [
    links.channelUrl && (
      <JoinCard
        key="channel"
        id="tg-channel-title"
        kind="ערוץ"
        title="ערוץ המומלצים בטלגרם"
        body="מוצרים שבחרנו מתוך מה שעבר את הסינון, ישר לטלגרם: מחיר, קוד הנחה כשיש, ומספרי המשוב והמכירות מאלי אקספרס."
        points={[
          "כמה מוצרים נבחרים ביום, בלי הצפה",
          "כל התמונות והסרטון של המוצר בפוסט אחד",
          ...(links.pollEnabled ? ["סקר שבועי: אתם בוחרים מה נחפש"] : []),
        ]}
        preview={<ChannelPreview />}
        href={links.channelUrl}
        cta="הצטרפות לערוץ"
      />
    ),
    links.groupUrl && (
      <JoinCard
        key="group"
        id="tg-group-title"
        kind="קבוצה"
        title="קבוצת החיפוש בטלגרם"
        body="כותבים בקבוצה מה אתם מחפשים, בעברית חופשית, והסוכן שלנו מחזיר את 5 התוצאות הכי טובות שמצא באלי אקספרס."
        points={[
          "תמונה אחת עם המוצרים, מסודרים לפי אמינות",
          "מחיר, משוב ומכירות מאלי אקספרס לכל מוצר",
          `עד ${links.dailyLimit} חיפושים ביום לכל חבר בקבוצה`,
        ]}
        preview={<GroupPreview />}
        href={links.groupUrl}
        cta="הצטרפות לקבוצת החיפוש"
      />
    ),
  ].filter(Boolean);
  return (
    <section
      aria-labelledby="telegram-title"
      className="mx-auto mt-12 max-w-6xl px-4 sm:mt-16 sm:px-6"
    >
      <div className="mx-auto max-w-2xl space-y-2 text-center">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-tg-soft px-3 py-1 text-sm font-semibold text-tg-ink">
          <TelegramMark className="size-4" />
          טלגרם
        </p>
        <h2 id="telegram-title" className="font-display text-3xl text-balance">
          מצאתי גם בטלגרם
        </h2>
        <p className="text-pretty text-muted">
          מוצרים מומלצים ישר אליכם, או חיפוש בקבוצה בלי לפתוח את האתר.
        </p>
      </div>
      <ul className={`mt-6 grid gap-4 ${cards.length > 1 ? "md:grid-cols-2" : "mx-auto max-w-xl"}`}>
        {cards}
      </ul>
    </section>
  );
}
