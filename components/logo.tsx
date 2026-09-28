import Link from "next/link";
import { BRAND } from "@/lib/config/brand";

export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" aria-hidden className={className}>
      <rect width="36" height="36" rx="11" fill="var(--accent)" />
      <circle cx="16" cy="16" r="7.5" fill="none" stroke="var(--on-accent)" strokeWidth="2.6" />
      <path
        d="M21.6 21.6 27 27"
        stroke="var(--on-accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="m12.6 16.2 2.3 2.3 4.4-4.6"
        fill="none"
        stroke="var(--gold)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo() {
  return (
    // A slightly tighter gap under 390px keeps the header row inside the page gutter.
    <Link href="/" className="flex min-h-11 items-center gap-2 rounded-full min-[390px]:gap-2.5">
      <LogoMark />
      <span className="font-display text-2xl leading-none text-ink">{BRAND.name}</span>
    </Link>
  );
}
