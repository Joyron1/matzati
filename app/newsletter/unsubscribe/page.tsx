import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, MailX, type LucideIcon } from "lucide-react";
import { UnsubscribeButton } from "@/components/newsletter/unsubscribe-button";
import { ContactEmail } from "@/components/static-page";
import { btnMd, btnSecondary, featured } from "@/components/styles";
import { unsubscribeFromNewsletter } from "@/lib/newsletter/actions";
import { NEWSLETTER_PRIVACY_HREF } from "@/lib/newsletter/consent";
import { isUnsubscribeToken } from "@/lib/newsletter/token";
import { firstParam } from "@/lib/search-url";

// The unsubscribe link of every newsletter message: /newsletter/unsubscribe?token=… Opening it
// changes nothing (mail scanners open links too): the visitor confirms with a button, a server
// action that works without JavaScript and then shows the result on a URL without the token.
// No sign-in, and the page never shows the address. Reading the token here touches no database.
export const metadata: Metadata = {
  title: "הסרה מרשימת התפוצה",
  robots: { index: false, follow: false },
};

function Panel({
  Icon,
  tone,
  title,
  children,
}: {
  Icon: LucideIcon;
  tone: "accent" | "gold";
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="unsubscribe-title"
      className={`${featured} mx-auto max-w-xl space-y-5 p-6 text-center sm:p-10`}
    >
      <span
        className={`mx-auto grid size-14 place-items-center rounded-full ${
          tone === "accent" ? "bg-accent-soft text-accent-ink" : "bg-gold-soft text-ink"
        }`}
      >
        <Icon aria-hidden className="size-7" />
      </span>
      <h1
        id="unsubscribe-title"
        className="font-display text-3xl leading-tight text-balance sm:text-4xl"
      >
        {title}
      </h1>
      {children}
    </section>
  );
}

const homeLink = (
  <Link href="/" className={`${btnSecondary} ${btnMd}`}>
    לדף הבית
  </Link>
);

export default async function UnsubscribePage({
  searchParams,
}: PageProps<"/newsletter/unsubscribe">) {
  const params = await searchParams;
  const status = firstParam(params.status);
  const token = firstParam(params.token);

  let body: ReactNode;
  if (status === "done") {
    body = (
      <Panel Icon={CircleCheck} tone="accent" title="הסרנו אתכם מרשימת התפוצה">
        {/* role="status": after the confirm button, the new page says what happened. */}
        <p role="status" className="text-lg leading-relaxed text-muted">
          לא נשלח יותר עדכונים לכתובת הזו. אם תתחרטו, אפשר להירשם שוב בכל עת בתחתית כל עמוד באתר.
        </p>
        {homeLink}
      </Panel>
    );
  } else if (status === "invalid" || !isUnsubscribeToken(token)) {
    body = (
      <Panel Icon={CircleAlert} tone="gold" title="הקישור להסרה לא תקין">
        <p className="text-lg leading-relaxed text-muted">
          ייתכן שהקישור נקטע בדרך. נסו לפתוח אותו שוב מתוך ההודעה, או כתבו לנו ל־
          <ContactEmail /> ונסיר אתכם מהרשימה.
        </p>
        {homeLink}
      </Panel>
    );
  } else {
    body = (
      <Panel Icon={MailX} tone="accent" title="הסרה מרשימת התפוצה">
        <p className="text-lg leading-relaxed text-muted">
          לאשר את ההסרה? לא נשלח יותר עדכונים על מבצעים וקופונים לכתובת שבה קיבלתם את הקישור.
        </p>
        {status === "error" && (
          <p
            role="alert"
            className="flex items-start gap-3 rounded-2xl bg-gold-soft px-4 py-3 text-start font-semibold text-ink"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            לא הצלחנו להסיר את ההרשמה כרגע. נסו שוב בעוד רגע.
          </p>
        )}
        <form action={unsubscribeFromNewsletter}>
          <input type="hidden" name="token" value={token} />
          <UnsubscribeButton />
        </form>
        <p className="text-sm text-muted">
          <Link
            href={NEWSLETTER_PRIVACY_HREF}
            className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline underline-offset-4 hover:text-ink"
          >
            מה אנחנו שומרים אחרי ההסרה
          </Link>
        </p>
      </Panel>
    );
  }

  return <div className="px-4 pt-10 sm:px-6 sm:pt-16">{body}</div>;
}
