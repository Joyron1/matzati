const PILL_WIDTHS = [64, 96, 120, 88, 104];

export default function RecentSearchesLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 sm:px-6 sm:pt-12" aria-busy="true">
      <div className="max-w-2xl space-y-3">
        <h1 className="font-display text-4xl sm:text-5xl">חיפושים אחרונים</h1>
        <p role="status" className="text-lg leading-relaxed text-muted">
          טוענים את החיפושים האחרונים...
        </p>
      </div>
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="h-[76px] max-w-xl animate-pulse rounded-card bg-surface-2" />
          <div className="flex gap-2 overflow-hidden">
            {PILL_WIDTHS.map((w) => (
              <div
                key={w}
                className="h-11 shrink-0 animate-pulse rounded-full bg-surface-2"
                style={{ width: w }}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[300px] animate-pulse rounded-card bg-surface-2" />
          ))}
        </div>
      </div>
    </div>
  );
}
