"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useMemo } from "react";
import { btnBusy, btnSecondary } from "@/components/styles";
import { hideSearchAction, restoreSearchAction, type SearchActionState } from "./actions";

const btnSm = "min-h-11 px-4 text-sm";
const NO_ERROR: SearchActionState = { error: null };

const MODES = {
  hide: { action: hideSearchAction, Icon: EyeOff, label: "הסתרה", pending: "מסתירים…" },
  restore: { action: restoreSearchAction, Icon: Eye, label: "החזרה", pending: "מחזירים…" },
} as const;

interface SearchRowActionProps {
  queryNorm: string;
  /** The query as shown in the row, read out with the button. */
  query: string;
  mode: keyof typeof MODES;
}

/** "הסתרה" for a listed search, "החזרה" for a hidden one. Both can be undone, so no confirm. */
export function SearchRowAction({ queryNorm, query, mode }: SearchRowActionProps) {
  const { action, Icon, label, pending: pendingLabel } = MODES[mode];
  const bound = useMemo(() => action.bind(null, queryNorm), [action, queryNorm]);
  const [state, formAction, pending] = useActionState(bound, NO_ERROR);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      className="flex shrink-0 flex-col gap-2 lg:items-end"
    >
      {/* aria-disabled, not disabled: the button keeps keyboard focus while the action runs. */}
      <button
        type="submit"
        aria-disabled={pending}
        className={`${btnSecondary} ${btnSm} ${btnBusy}`}
      >
        <Icon aria-hidden className="size-4" />
        {pending ? pendingLabel : label}
        <span className="sr-only">: {query}</span>
      </button>
      {state.error && (
        <p role="alert" className="text-sm font-semibold">
          {state.error}
        </p>
      )}
    </form>
  );
}
