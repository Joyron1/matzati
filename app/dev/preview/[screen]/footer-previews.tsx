// Development previews of the footer and the newsletter (./page.tsx): /dev/preview/footer renders
// the footer's content with made-up data and a newsletter form that stores nothing, and
// /dev/preview/admin-newsletter the /admin/newsletter view with made-up subscribers. Nothing here
// reads the database. The page's own footer (the real one) still renders under the preview.
//
// /dev/preview/footer?state=subscribed|invalid_email|consent_required|rate_limited|unavailable
//   shows the form in that state from the start; &offers=1 adds the coupons, sales and deals links
//   (shown while those pages have content); &community=1 shows the community button (hidden
//   while the owner has not set a link).
import type { ReactNode } from "react";
import { NewsletterAdminView } from "@/app/admin/newsletter/newsletter-admin-view";
import { NewsletterCard } from "@/components/newsletter/newsletter-card";
import { FooterView } from "@/components/site-footer";
import { ADMIN_PAGE_SIZE, pageCount } from "@/lib/newsletter/admin";
import {
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_IDLE,
  newsletterState,
  type NewsletterStatus,
} from "@/lib/newsletter/consent";
import { firstParam } from "@/lib/search-url";
import { PreviewNewsletterForm } from "./newsletter-preview";

type Params = Record<string, string | string[] | undefined>;

const STATES: readonly NewsletterStatus[] = [
  "subscribed",
  "invalid_email",
  "consent_required",
  "rate_limited",
  "unavailable",
];

const SAMPLE_EMAIL: Partial<Record<NewsletterStatus, string>> = {
  invalid_email: "dana@example",
  consent_required: "dana@example.com",
  rate_limited: "dana@example.com",
  unavailable: "dana@example.com",
};

export function FooterPreview({
  params,
  note,
}: {
  params: Params;
  note: (text: string) => ReactNode;
}) {
  const requested = firstParam(params.state) as NewsletterStatus;
  const status = STATES.includes(requested) ? requested : "idle";
  const initial =
    status === "idle"
      ? NEWSLETTER_IDLE
      : newsletterState(status, {
          email: SAMPLE_EMAIL[status],
          consent: status !== "consent_required",
        });
  const offers = firstParam(params.offers) === "1";
  const community = firstParam(params.community) === "1";
  return (
    <>
      {note(
        `הפוטר עם נתונים לדוגמה${status === "idle" ? "" : `, טופס הניוזלטר במצב ״${status}״`}${
          community ? ", עם כפתור הקהילה" : ""
        }. ההרשמה כאן לא שומרת כלום (כתובת עם limit או fail מראה את השגיאות).`,
      )}
      <FooterView
        preview
        offers={{ deals: offers, sales: offers, coupons: offers }}
        community={
          community
            ? { url: "https://chat.whatsapp.com/preview-made-up", label: "הצטרפו לקהילה שלנו" }
            : null
        }
        newsletter={
          <NewsletterCard titleId="preview-newsletter-title">
            <PreviewNewsletterForm initial={initial} />
          </NewsletterCard>
        }
      />
    </>
  );
}

/** /dev/preview/admin-newsletter?n=<active count> (default 137; 0 shows the empty state). */
export function AdminNewsletterPreview({ params, now }: { params: Params; now: Date }) {
  const n = Number.parseInt(firstParam(params.n), 10);
  const active = Number.isFinite(n) && n >= 0 ? Math.min(n, 5000) : 137;
  const pages = pageCount(active);
  const page = Math.min(Math.max(1, Number.parseInt(firstParam(params.page), 10) || 1), pages);
  const first = (page - 1) * ADMIN_PAGE_SIZE;
  const rows = Array.from(
    { length: Math.max(0, Math.min(ADMIN_PAGE_SIZE, active - first)) },
    (_, i) => {
      const k = first + i;
      return {
        email:
          k % 7 === 3
            ? `a.very.long.address.for.wrapping.${k}@subdomain.example-made-up.co.il`
            : `subscriber${k}@example.com`,
        consentedAt: new Date(now.getTime() - (k + 1) * 3.7 * 3_600_000).toISOString(),
        source: "footer",
        consentVersion: NEWSLETTER_CONSENT_VERSION,
      };
    },
  );
  return (
    <NewsletterAdminView
      data={{ counts: { active, unsubscribed: Math.round(active / 9) }, rows, page, pages }}
      exportHref={null}
      path="/dev/preview/admin-newsletter"
    />
  );
}
