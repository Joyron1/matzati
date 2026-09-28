// Free offline evaluation (docs/search-quality-plan.md, item 1): replays every product-pool
// snapshot in fixtures/snapshots/ through a fetch policy and the current ranking code, and reports
// per query and in total what a search would show. No network, no LLM, no env, no database:
// ranking, type-gate, diversity and fetch-policy changes are measured here, in seconds, for $0.
//
// Usage (from the repo root):
//   npm run eval:offline                                  the live pipeline's fetch policy
//   npm run eval:offline -- --compare current,until-6-3   baseline and candidate in one run
//   npm run eval:offline -- --name before                 save as report-before.json, then
//     (change lib/ranking) npm run eval:offline -- --against before
//   report-baseline-r5.json is the live pipeline under RANKING_VERSION 5 (2026-09-28), before any
//   wave A ranking change: `--against baseline-r5` shows what a change did to every query.
// A new fetch rule is a FetchPolicy in lib/eval/policies.ts (add it to POLICIES). CURRENT_POLICY
// runs nextFetch of lib/search/fetch-policy.ts, as the pipeline does (lib/eval/parity.test.ts);
// `--compare r5,current` shows what item 5 changed under today's ranking.
// Options:
//   --policy <name>        current (default), r5 (the fetch rule before item 5), all,
//                          until-<target>-<maxCalls> (lib/eval/policies.ts)
//   --compare <a>,<b>      run two policies and compare them query by query
//   --against <name>       compare with fixtures/snapshots/report-<name>.json (a saved run)
//   --name <name>          report file name (default from the options): report-<name>.json;
//                          by default a run with --against gets its own name, so it does not
//                          overwrite the report it compares with
//   --only <id,id>         only these snapshots; --group eval|example|live; --skip-copies
//   --sort <preference>    as the refine buttons: best_value, cheapest, most_popular
//   --shop-cap <mode>      the admin's shop cap setting the ranking runs under: none (the default
//                          setting) or max2; "none,max2" runs both and compares them
//   --without <id,id>      removed chips: req:<en>, req:* (every requirement), min, max
//   --renormalize          run each stored parse through the current normalizeParsed first
//   --detail               list the first 6 results of every query (to read or to label)
//   --no-write             print only
// Labels: fixtures/snapshots/labels/*.json, entries { productId, label, note } with label exact,
// reasonable, weak or wrong (lib/eval/labels.ts). Without labels the label metrics are left out.
import { loadLabels, loadSnapshots, readReport, reportPath, writeReport } from "@/lib/eval/files";
import { formatComparison, formatDetail, formatRun } from "@/lib/eval/format";
import { policyByName } from "@/lib/eval/policies";
import { renormalizeParse, type Variant } from "@/lib/eval/replay";
import {
  compareRuns,
  newReport,
  relabelRun,
  runVariant,
  type EvalReport,
  type EvalRun,
} from "@/lib/eval/report";
import type { Snapshot } from "@/lib/eval/snapshot";
import {
  DEFAULT_SHOP_CAP_MODE,
  isShopCapMode,
  SHOP_CAP_MODES,
  type ShopCapMode,
} from "@/lib/ranking/config";
import type { SortPreference } from "@/lib/search/filters";

const SORTS: readonly SortPreference[] = ["best_value", "cheapest", "most_popular"];
const GROUPS = ["eval", "example", "live"] as const;

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
function value(flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const v = args[at + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
  return v;
}
const list = (flag: string) =>
  (value(flag) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const KNOWN = new Set([
  "--policy",
  "--compare",
  "--against",
  "--name",
  "--only",
  "--group",
  "--skip-copies",
  "--sort",
  "--shop-cap",
  "--without",
  "--renormalize",
  "--detail",
  "--no-write",
]);

function selectSnapshots(all: Snapshot[]): { snapshots: Snapshot[]; partial: boolean } {
  let out = all;
  const only = list("--only");
  if (only.length) {
    const unknown = only.filter((id) => !all.some((s) => s.id === id));
    if (unknown.length) throw new Error(`--only: no snapshot ${unknown.join(", ")}`);
    out = out.filter((s) => only.includes(s.id));
  }
  const group = value("--group");
  if (group !== undefined) {
    if (!(GROUPS as readonly string[]).includes(group)) {
      throw new Error(`--group must be one of ${GROUPS.join(", ")}`);
    }
    out = out.filter((s) => s.group === group);
  }
  if (has("--skip-copies")) out = out.filter((s) => !s.sameQueryAs);
  return { snapshots: out, partial: out.length !== all.length };
}

function main() {
  for (const a of args) {
    if (a.startsWith("--") && !KNOWN.has(a)) throw new Error(`unknown option ${a}`);
  }
  const sortArg = value("--sort");
  if (sortArg !== undefined && !(SORTS as readonly string[]).includes(sortArg)) {
    throw new Error(`--sort must be one of ${SORTS.join(", ")}`);
  }
  const sort = sortArg as SortPreference | undefined;
  const without = list("--without");
  const renormalize = has("--renormalize");

  const shopCaps = list("--shop-cap");
  const badCap = shopCaps.find((m) => !isShopCapMode(m));
  if (badCap !== undefined || (value("--shop-cap") !== undefined && !shopCaps.length)) {
    throw new Error(`--shop-cap must be one of ${SHOP_CAP_MODES.join(", ")}, or two of them`);
  }
  if (shopCaps.length > 2) throw new Error("--shop-cap takes one mode, or two to compare");

  const compare = list("--compare");
  if (value("--compare") !== undefined && compare.length !== 2) {
    throw new Error("--compare takes two policies: <baseline>,<candidate>");
  }
  if (compare.length && shopCaps.length === 2) {
    throw new Error("compare two policies or two shop cap modes, not both");
  }
  const policyNames = compare.length ? compare : [value("--policy") ?? "current"];
  const modes = (shopCaps.length ? shopCaps : [DEFAULT_SHOP_CAP_MODE]) as ShopCapMode[];
  const variants: Variant[] = policyNames.flatMap((name) =>
    modes.map((shopCap) => ({
      name: modes.length === 2 ? `${name}-${shopCap}` : name,
      policy: policyByName(name),
      shopCap,
      ...(sort ? { sort } : {}),
      ...(without.length ? { without } : {}),
      ...(renormalize ? { adjustParse: renormalizeParse } : {}),
    })),
  );
  const comparing = variants.length === 2;

  const { snapshots, partial } = selectSnapshots(loadSnapshots());
  if (!snapshots.length) throw new Error("no snapshot selected");
  const labels = loadLabels();

  const runs: EvalRun[] = variants.map((v) => runVariant(snapshots, labels.book, v));
  const tags = [
    sort ? `sort-${sort}` : "",
    without.length ? `without-${without.join("+").replace(/[^a-z0-9._+-]/gi, "")}` : "",
    renormalize ? "renormalized" : "",
    shopCaps.length === 1 ? `shopcap-${shopCaps[0]}` : "",
    partial ? "partial" : "",
    // Never overwrite the saved report this run is compared with.
    value("--against") !== undefined ? `vs-${value("--against")}` : "",
  ].filter(Boolean);
  const name =
    value("--name") ??
    [comparing ? variants.map((v) => v.name).join("-vs-") : policyNames[0], ...tags].join("_");
  const report: EvalReport = newReport(
    name,
    snapshots,
    {
      files: labels.files,
      queries: labels.book.size,
      entries: labels.entries,
    },
    runs,
  );

  for (const run of runs) {
    console.log(`${formatRun(run)}\n`);
    if (has("--detail")) console.log(`${formatDetail(run)}\n`);
  }
  if (runs.length === 2) {
    const source = compare.length ? "--compare" : "--shop-cap";
    report.comparisons.push({ ...compareRuns(runs[0], runs[1]), source });
  }
  const against = value("--against");
  if (against !== undefined) {
    const path = reportPath(against);
    const saved = readReport(path);
    const savedRun =
      saved.runs.find((r) => r.variant.name === runs[0].variant.name) ?? saved.runs[0];
    // Both result lists judged by today's labels (see relabelRun).
    const base = relabelRun(savedRun, labels.book);
    const source =
      saved.rankingVersion === report.rankingVersion
        ? path
        : `${path}, RANKING_VERSION ${saved.rankingVersion} → ${report.rankingVersion}`;
    report.comparisons.push({ ...compareRuns(base, runs[0]), source });
    if (saved.labels.entries !== labels.entries) {
      console.log(
        `Note: ${path} was made with ${saved.labels.entries} labels, now ${labels.entries}. ` +
          `Its first two pages are relabelled; its type-gate and false-positive counts are as saved.\n`,
      );
    }
  }
  for (const c of report.comparisons) console.log(`${formatComparison(c)}\n`);

  console.log(
    `${snapshots.length} snapshots, ${labels.entries} labels in ${labels.files.length} files. ` +
      `Legend: calls p1/p2 = pages of the primary keywords, L1.. = ladder steps; page1 labels ` +
      `E exact, R reasonable, w weak, X wrong, ? unlabelled; shop = most results of one shop on page 1.`,
  );
  if (!has("--no-write")) {
    const path = reportPath(name);
    writeReport(path, report);
    console.log(`Wrote ${path}`);
  }
}

try {
  main();
} catch (err) {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
