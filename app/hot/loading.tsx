const PILL_WIDTHS = [64, 136, 152, 128, 120];

// The page's layout (app/hot/page.tsx): on phones the filters are one closed "סינון ומיון" row.
export default function HotLoading() {
  return (
    <div
      className="mx-auto max-w-6xl space-y-5 px-4 pt-6 sm:space-y-8 sm:px-6 sm:pt-12"
      aria-busy="true"
    >
      <div className="max-w-2xl space-y-3">
        <h1 className="font-display text-4xl sm:text-5xl">מוצרים חמים</h1>
        <p role="status" className="text-lg leading-relaxed text-muted">
          טוענים את המוצרים החמים...
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex gap-2 overflow-hidden py-1.5">
          {PILL_WIDTHS.map((w) => (
            <div
              key={w}
              className="h-11 shrink-0 animate-pulse rounded-full bg-surface-2"
              style={{ width: w }}
            />
          ))}
        </div>
        <div className="h-12 animate-pulse rounded-full bg-surface-2 sm:h-[12rem] sm:rounded-card lg:h-[6.5rem]" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-[3/5] animate-pulse rounded-card bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
