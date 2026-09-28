import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import { StateCard } from "@/components/state-card";
import { requireAdmin } from "@/lib/admin/auth";
import { usdIlsFallback } from "@/lib/env";
import { fetchUsdIlsRate } from "@/lib/fx/boi";
import { dailySearchCap } from "@/lib/search/server";
import { loadAdminStats, STATS_DAYS, type AdminStats } from "@/lib/stats/queries";
import { serviceClient } from "@/lib/supabase/server";
import {
  ClickPositionsTable,
  DailyTable,
  FailuresTable,
  FxNote,
  LlmByKindTable,
  OriginTable,
  TodaySummary,
  TopProductsTable,
  TopQueriesTable,
  ZeroResultTable,
} from "./sections";

export const metadata: Metadata = {
  title: "נתונים", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const errorText = (err: unknown) =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

/** DAILY_SEARCH_CAP as the search guard reads it, or null when it is misconfigured. */
function cap(): number | null {
  try {
    return dailySearchCap();
  } catch (err) {
    console.error(`[stats] ${errorText(err)}`);
    return null;
  }
}

/** USD_ILS_FALLBACK, or its default when the configured value is invalid. */
function fallbackRate(): number {
  try {
    return usdIlsFallback();
  } catch {
    return usdIlsFallback({ ...process.env, USD_ILS_FALLBACK: undefined });
  }
}

async function load(): Promise<AdminStats | null> {
  try {
    return await loadAdminStats({
      db: serviceClient(),
      now: new Date(),
      cap: cap(),
      fx: () => fetchUsdIlsRate(fallbackRate()),
    });
  } catch (err) {
    // Missing Supabase config: nothing can be read. Name and message only, never values.
    console.error(`[stats] ${errorText(err).slice(0, 300)}`);
    return null;
  }
}

export default async function StatsPage() {
  // The layout guards /admin too, but it does not re-run on client navigation (Next.js auth guide).
  await requireAdmin();
  const stats = await load();
  const nothing =
    !stats ||
    (!stats.daily &&
      !stats.topQueries &&
      !stats.zeroResultQueries &&
      !stats.topProducts &&
      !stats.llmByKind &&
      !stats.byOrigin &&
      !stats.failures &&
      !stats.clickPositions);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">נתונים</h1>
        <p className="text-muted">
          מה קורה באתר ומה זה עולה: {STATS_DAYS} הימים האחרונים לפי שעון ישראל, נכון לרגע טעינת הדף.
          רק האתר החי: בדיקות מסביבת הפיתוח ומגרסאות תצוגה מקדימה לא נספרות, וגם לא חיפושים וקליקים
          שנעשו כשהייתם מחוברים לניהול. עלות מודל השפה כוללת את כל הקריאות באתר החי. בלי כתובות IP
          ובלי פרטים על המבקרים.
        </p>
      </div>

      {!stats || nothing ? (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את הנתונים">
          <p className="max-w-prose text-muted">
            נסו לרענן את הדף בעוד רגע. אם זו הפעם הראשונה, ודאו שהמיגרציה{" "}
            <bdi dir="ltr" className="font-mono">
              phase2_stats
            </bdi>{" "}
            הוחלה על מסד הנתונים.
          </p>
        </StateCard>
      ) : (
        <>
          <TodaySummary
            today={stats.daily?.[0] ?? null}
            counter={stats.budgetCounter}
            cap={stats.budgetCap}
            fx={stats.fx}
          />
          <DailyTable days={stats.daily} fx={stats.fx} windowDays={STATS_DAYS} />
          <OriginTable rows={stats.byOrigin} />
          <FailuresTable rows={stats.failures} />
          <ClickPositionsTable rows={stats.clickPositions} />
          <LlmByKindTable rows={stats.llmByKind} fx={stats.fx} />
          <TopQueriesTable rows={stats.topQueries} />
          <ZeroResultTable rows={stats.zeroResultQueries} />
          <TopProductsTable rows={stats.topProducts} />
          <FxNote fx={stats.fx} />
        </>
      )}
    </div>
  );
}
