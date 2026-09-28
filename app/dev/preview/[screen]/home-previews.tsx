// Development-only preview of the home page's "חיפושים אחרונים" strip (./page.tsx dispatches to
// it) with 1 to 6 made-up searches, ?n=<count> (2 by default, what production had): the tiles
// center as a group under the title whatever their count. No photos (made-up searches have none),
// no database read; the tiles link to made-up searches, so the strip is inert here.
import { RecentSearchesTiles } from "@/components/recent-searches-strip";
import type { RecentSearch } from "@/lib/recent/types";

const LABELS = [
  "ריסים להדבקה",
  "מיטה לכלב",
  "סוללת גיבוי",
  "מחזיק טלפון לרכב",
  "מנורת לילה",
  "רמקול",
];

function fakeSearches(n: number, now: Date): RecentSearch[] {
  return LABELS.slice(0, n).map((label, i) => ({
    queryNorm: `preview-${i}`,
    query: label,
    chips: [{ id: "product", kind: "keywords", label_he: label, removable: false }],
    categoryId: null,
    categoryHe: null,
    images: [],
    resultsCount: 3,
    searchedAt: new Date(now.getTime() - i * 3_600_000).toISOString(),
  }));
}

export function RecentStripPreview({ n, now }: { n: number; now: Date }) {
  return (
    <div inert className="mx-auto mt-10 max-w-6xl px-4 sm:px-6">
      <RecentSearchesTiles searches={fakeSearches(n, now)} />
    </div>
  );
}
