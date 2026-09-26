import type { ReactNode } from "react";

/** Layout for the legal/static pages. Text marked [PLACEHOLDER] is for the owner to complete. */
export function StaticPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 pt-10 sm:px-6 sm:pt-14">
      <h1 className="font-display text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-muted">עודכן לאחרונה: [PLACEHOLDER: תאריך]</p>
      <div className="mt-8 space-y-6 leading-relaxed [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ms-5 [&_li]:list-disc [&_p]:text-ink/90 [&_ul]:space-y-2">
        {children}
      </div>
    </article>
  );
}
