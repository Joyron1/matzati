import type { ReactNode } from "react";
import { Mail, TicketPercent } from "lucide-react";

/**
 * The footer's newsletter card: the pitch beside the form (under it on phones). `children` is the
 * form (NewsletterForm with its action). `titleId` must be unique in the page (the dev preview
 * renders a second card).
 */
export function NewsletterCard({
  titleId = "newsletter-title",
  children,
}: {
  titleId?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className="relative isolate overflow-hidden rounded-composer border border-line bg-linear-to-bl from-accent-soft via-bg to-bg p-5 sm:p-8 lg:p-10"
    >
      {/* Two soft glows, cobalt behind the pitch and marigold behind the form. Decoration only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -start-16 -top-24 -z-10 size-72 rounded-full bg-accent-soft opacity-90 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -end-20 -bottom-28 -z-10 size-72 rounded-full bg-gold-soft opacity-90 blur-3xl dark:opacity-50"
      />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] md:items-center md:gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-on-accent">
              <Mail aria-hidden className="size-6" />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-gold ring-inset">
              <TicketPercent aria-hidden className="size-4" />
              מבצעים וקופונים
            </span>
          </div>
          <h2
            id={titleId}
            className="mt-5 font-display text-[1.75rem] leading-tight text-balance text-ink sm:text-3xl lg:text-4xl"
          >
            מבצעים וקופונים, ישר למייל
          </h2>
          <p className="mt-3 max-w-md leading-relaxed text-muted sm:text-lg">
            הירשמו ונעדכן אתכם באימייל על מבצעים וקופונים לקניות באלי אקספרס, כדי שלא תפספסו הנחה.
          </p>
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}
