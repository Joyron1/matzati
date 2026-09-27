export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10" aria-busy="true">
      <div role="status" className="space-y-1">
        <p className="text-lg font-semibold">מחפשים ומסננים בשבילכם...</p>
        <p className="text-sm text-muted">
          אנחנו בודקים מוצרים באלי אקספרס לפי משוב של קונים ומספר מכירות. זה יכול לקחת כמה שניות.
        </p>
      </div>
      <div className="h-[60px] animate-pulse rounded-full bg-surface-2" />
      <div className="flex gap-2">
        {[120, 100, 90].map((w) => (
          <div
            key={w}
            className="h-11 animate-pulse rounded-full bg-surface-2"
            style={{ width: w }}
          />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="h-[520px] animate-pulse rounded-composer bg-surface-2" />
        <div className="grid gap-5">
          <div className="h-[250px] animate-pulse rounded-card bg-surface-2" />
          <div className="h-[250px] animate-pulse rounded-card bg-surface-2" />
        </div>
      </div>
    </div>
  );
}
