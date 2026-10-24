import { LogOut } from "lucide-react";

/** The signed-in address and the sign-out button, at the end of the sidebar and the phone sheet. */
export function AdminAccount({ email, signOut }: { email: string; signOut?: () => Promise<void> }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <p className="min-w-0 flex-1 truncate text-sm text-muted">
        <span className="sr-only">מחוברים בתור </span>
        <bdi dir="ltr">{email}</bdi>
      </p>
      <form action={signOut}>
        <button
          type="submit"
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
        >
          <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
          יציאה
        </button>
      </form>
    </div>
  );
}
