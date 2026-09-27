import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { card } from "./styles";

/** Empty and error states: what happened, and what to do next. */
export function StateCard({
  Icon,
  title,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={`${card} flex flex-col items-center gap-4 px-6 py-12 text-center`}>
      <span className="grid size-14 place-items-center rounded-full bg-gold-soft text-ink">
        <Icon aria-hidden className="size-7" />
      </span>
      <h2 className="font-display text-2xl text-balance">{title}</h2>
      {children}
    </section>
  );
}
