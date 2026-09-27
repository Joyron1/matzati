// The holiday deals a coupon can be linked to, for the admin form's select and the admin list.
// Server only (service role through listAllDeals); callers have passed requireAdmin().
import "server-only";
import { listAllDeals } from "@/lib/deals/queries";
import { hasEnded } from "@/lib/deals/time";
import { formatShortDate } from "@/lib/format";
import type { Deal } from "@/lib/types";

export interface SaleOption {
  id: string;
  /** "מבצע 11.11 · 11.11", with "(טיוטה)" / "(הסתיים)" when that applies. */
  label: string;
  title: string;
}

function label(sale: Deal, now: Date): string {
  const notes = [!sale.published && "טיוטה", hasEnded(sale, now) && "הסתיים"].filter(Boolean);
  const date = sale.starts_at ? ` · ${formatShortDate(sale.starts_at)}` : "";
  return `${sale.title}${date}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/**
 * Every holiday deal, drafts included (a coupon can be prepared before its sale is published):
 * running and upcoming ones first by start, then ended ones, the latest first. Null when the
 * deals cannot be loaded; the form then offers "ללא מבצע" only.
 */
export async function loadSaleOptions(now: Date): Promise<SaleOption[] | null> {
  let deals: Deal[];
  try {
    deals = await listAllDeals();
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-coupons] sales: ${text.slice(0, 300)}`);
    return null;
  }
  const start = (d: Deal) => (d.starts_at ? Date.parse(d.starts_at) : 0);
  const sales = deals.filter((d) => d.type === "holiday");
  const live = sales.filter((d) => !hasEnded(d, now)).sort((a, b) => start(a) - start(b));
  const ended = sales.filter((d) => hasEnded(d, now)).sort((a, b) => start(b) - start(a));
  return [...live, ...ended].map((d) => ({ id: d.id, label: label(d, now), title: d.title }));
}
