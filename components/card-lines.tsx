import { hasHebrew } from "@/lib/product-title";

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/**
 * A result card's title. Without a Hebrew title of ours (the explain step failed, or rejected it)
 * it is AliExpress's English title: laid out left to right as a block of its own (lang en, so a
 * screen reader reads it with an English voice), so a clamp cuts it at its own end, not its start,
 * and aligned to the end of its lines, the right edge the Hebrew column shares. `clamp`: at most
 * two lines.
 */
export function TitleText({ title, clamp = false }: { title: string; clamp?: boolean }) {
  if (hasHebrew(title)) {
    return clamp ? <span className="line-clamp-2">{title}</span> : title;
  }
  return (
    <span dir="ltr" lang="en" className={cx("text-end", clamp ? "line-clamp-2" : "block")}>
      {title}
    </span>
  );
}
