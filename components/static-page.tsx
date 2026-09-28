import Link from "next/link";
import type { ReactNode } from "react";
import {
  LEGAL,
  LEGAL_PAGE_NAMES,
  LEGAL_PATHS,
  LEGAL_UPDATED_AT,
  formatLegalDate,
  type LegalPage,
} from "@/lib/config/legal";
import { HashTargetFocus } from "./hash-target-focus";
import { InPageLink } from "./in-page-link";
import { PrintButton } from "./print-button";
import { card } from "./styles";

export interface PageSection {
  /** The anchor for deep links (/terms#affiliate). Stable: other pages link to it. */
  id: string;
  title: string;
}

/**
 * Printing a legal page leaves only the document: everything outside <main> (skip link, header,
 * footer, banners) is hidden, and the color tokens fall back to the paper's own colors, so the
 * dark theme prints as dark text on white. React keeps a hoisted <style> in <head> after a
 * client-side navigation away, so every rule is scoped to a page that shows a legal document.
 */
const PRINT_CSS = `@media print {
  body:has(.legal-doc) > :not(main) { display: none !important; }
  :root:has(.legal-doc), :root[data-theme]:has(.legal-doc) {
    color-scheme: light;
    --bg: Canvas;
    --surface: Canvas;
    --surface-2: Canvas;
    --gold-soft: Canvas;
    --ink: CanvasText;
    --muted: CanvasText;
    --accent-ink: CanvasText;
    --line: GrayText;
  }
}`;

// Text inside the sections: paragraphs, lists, h3 subsections and inline links.
const BODY =
  "mt-12 space-y-14 leading-relaxed [&_h3]:pt-2 [&_h3]:text-lg [&_h3]:font-bold [&_li]:marker:text-muted [&_li_a]:font-semibold [&_li_a]:text-accent-ink [&_li_a]:underline [&_li_a]:underline-offset-4 [&_li_a:hover]:text-ink [&_p]:text-ink/90 [&_p_a]:font-semibold [&_p_a]:text-accent-ink [&_p_a]:underline [&_p_a]:underline-offset-4 [&_p_a:hover]:text-ink [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:ps-5";

/**
 * Layout for the legal pages (lib/config/legal.ts): title, "עודכן לאחרונה", a print button, an
 * optional lead, the table of contents and links to the other legal pages. Sections are
 * LegalSection, each with an id for deep links.
 */
export function StaticPage({
  page,
  intro,
  sections = [],
  children,
}: {
  page: LegalPage;
  /** Lead paragraphs above the table of contents. */
  intro?: ReactNode;
  /** The page's sections in order, for the table of contents. */
  sections?: readonly PageSection[];
  children: ReactNode;
}) {
  const updatedAt = LEGAL_UPDATED_AT[page];
  const others = (Object.keys(LEGAL_PATHS) as LegalPage[]).filter((p) => p !== page);
  return (
    <article
      aria-labelledby="page-title"
      className="legal-doc mx-auto max-w-3xl px-4 pt-10 sm:px-6 sm:pt-14 print:max-w-none print:p-0"
    >
      <style href="legal-print" precedence="default">
        {PRINT_CSS}
      </style>
      <HashTargetFocus scope=".legal-doc" />

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="space-y-2">
          <h1 id="page-title" className="font-display text-4xl leading-tight">
            {LEGAL_PAGE_NAMES[page]}
          </h1>
          <p className="text-sm text-muted">
            עודכן לאחרונה: <time dateTime={updatedAt}>{formatLegalDate(updatedAt)}</time>
          </p>
        </div>
        <PrintButton className="print:hidden" />
      </div>

      {intro && (
        <div className="mt-6 space-y-3 text-lg leading-relaxed [&_a]:font-semibold [&_a]:text-accent-ink [&_a]:underline [&_a]:underline-offset-4">
          {intro}
        </div>
      )}

      {sections.length > 0 && (
        <nav aria-labelledby="toc-title" className={`${card} mt-8 p-5 sm:p-6 print:hidden`}>
          <h2 id="toc-title" className="font-bold">
            בעמוד הזה
          </h2>
          <ol className="mt-2 grid gap-x-6 sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.id}>
                <InPageLink
                  targetId={section.id}
                  className="inline-flex min-h-11 items-center text-accent-ink underline-offset-4 hover:underline"
                >
                  {section.title}
                </InPageLink>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className={BODY}>{children}</div>

      <nav
        aria-labelledby="legal-more-title"
        className="mt-16 border-t border-line pt-6 print:hidden"
      >
        <h2 id="legal-more-title" className="font-bold">
          מסמכים נוספים
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-6">
          {others.map((other) => (
            <li key={other}>
              <Link
                href={LEGAL_PATHS[other]}
                className="inline-flex min-h-11 items-center text-accent-ink underline underline-offset-4 hover:text-ink"
              >
                {LEGAL_PAGE_NAMES[other]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  );
}

/**
 * One section of a legal page. Focusable from script only, so a deep link puts keyboard and
 * screen-reader users at the section: the table of contents (InPageLink) focuses it, and
 * HashTargetFocus does it for every other way in (Next leaves focus on the link).
 */
export function LegalSection({ id, title, children }: PageSection & { children: ReactNode }) {
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 space-y-4 rounded-tile focus-visible:outline-offset-8"
    >
      <h2 id={`${id}-title`} className="font-display text-2xl leading-snug">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A detail the owner has not given yet (lib/config/legal.ts): shown as a marker, never invented. */
export function ToFill({ children }: { children: string }) {
  return (
    <mark className="rounded-md bg-gold-soft px-1.5 py-0.5 font-semibold text-ink ring-1 ring-gold ring-inset">
      [{children}]
    </mark>
  );
}

export const CONTACT_TO_FILL = "פרטי קשר יעודכנו בקרוב";

/** A mailto link, or the to-fill marker while the address is empty. */
export function EmailLink({ email }: { email: string }) {
  const value = email.trim();
  if (!value) return <ToFill>{CONTACT_TO_FILL}</ToFill>;
  return (
    <a href={`mailto:${value}`}>
      <bdi dir="ltr">{value}</bdi>
    </a>
  );
}

/** The general contact address (LEGAL.contactEmail). */
export function ContactEmail() {
  return <EmailLink email={LEGAL.contactEmail} />;
}

/** Who operates the site, with the business number when given. */
export function OperatorName() {
  const name = LEGAL.operatorName.trim();
  const businessId = LEGAL.operatorBusinessId.trim();
  if (!name) return <ToFill>שם מפעיל האתר יעודכן בקרוב</ToFill>;
  return (
    <>
      {name}
      {businessId && (
        <>
          {" "}
          (מספר רישום <bdi dir="ltr">{businessId}</bdi>)
        </>
      )}
    </>
  );
}
