"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "@/lib/use-mounted";

const OPTIONS = [
  { value: "light", label: "מצב בהיר", Icon: Sun },
  { value: "dark", label: "מצב כהה", Icon: Moon },
] as const;

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <div
      role="group"
      aria-label="ערכת צבעים"
      // 44px buttons (CLAUDE.md §9); no gap between them under 390px, where the header is tight.
      className="flex items-center gap-0 rounded-full border border-line bg-surface p-0.5 min-[390px]:gap-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const pressed = mounted && resolvedTheme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            onClick={() => setTheme(value)}
            className={`grid size-11 place-items-center rounded-full ${
              pressed ? "bg-ink text-bg" : "text-muted hover:text-ink"
            }`}
          >
            <Icon aria-hidden className="size-[18px]" strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
