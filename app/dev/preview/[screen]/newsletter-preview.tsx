"use client";

import { NewsletterForm } from "@/components/newsletter/newsletter-form";
import { newsletterState, type NewsletterFormState } from "@/lib/newsletter/consent";
import { parseSignupForm } from "@/lib/newsletter/schema";

/**
 * Development preview only: the footer's newsletter form with an action that stores nothing and
 * reaches no server. It answers with the real validation (lib/newsletter/schema.ts) after a short
 * wait (the busy button); an address containing "limit" gets the rate-limit answer and one
 * containing "fail" the "could not sign you up" answer, so every state can be tried by hand.
 */
export function PreviewNewsletterForm({ initial }: { initial: NewsletterFormState }) {
  return (
    <NewsletterForm
      initial={initial}
      action={async (_prev, formData) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const parsed = parseSignupForm(formData);
        if (parsed.kind === "bot") return newsletterState("subscribed");
        if (parsed.kind === "invalid") {
          return newsletterState(parsed.status, { email: parsed.email, consent: parsed.consent });
        }
        const keep = { email: parsed.email, consent: true };
        if (parsed.email.includes("limit")) return newsletterState("rate_limited", keep);
        if (parsed.email.includes("fail")) return newsletterState("unavailable", keep);
        return newsletterState("subscribed");
      }}
    />
  );
}
