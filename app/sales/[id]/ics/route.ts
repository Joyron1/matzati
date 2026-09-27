import type { NextRequest } from "next/server";
import { absoluteUrl, siteUrl } from "@/lib/config/site";
import { saleCalendarFile } from "@/lib/deals/ics";
import { publishedSale } from "@/lib/deals/queries";
import type { Deal } from "@/lib/types";

// "הוספה ליומן" on /sales: one published sale (deals row of type "holiday") as a calendar file.
// Drafts, other deal types and unknown ids are a 404; RLS hides drafts from the anon read too.

function page(status: number, title: string, text: string): Response {
  // A route handler cannot render app/not-found.tsx, so this is a minimal standalone page.
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${title}</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; text-align: center; line-height: 1.6">
<h1>${title}</h1>
<p>${text}</p>
<p><a href="/sales" style="display: inline-block; padding: 0.75rem 1.5rem">לכל המבצעים</a></p>
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(_request: NextRequest, ctx: RouteContext<"/sales/[id]/ics">) {
  const { id } = await ctx.params;
  let sale: Deal | null;
  try {
    // Ids that are not uuids come back null without a query.
    sale = await publishedSale(id);
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[sales-ics] ${text.slice(0, 300)}`);
    return page(503, "לא הצלחנו להכין את קובץ היומן", "נסו שוב בעוד רגע.");
  }
  if (!sale) return page(404, "המבצע לא נמצא", "ייתכן שהקישור ישן או שהמבצע הוסר מהיומן.");

  const file = saleCalendarFile(sale, {
    now: new Date(),
    host: new URL(siteUrl()).host,
    url: absoluteUrl(`/sales#sale-${sale.id}`),
  });
  return new Response(file, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Inline: iPhone Safari then offers "Add to Calendar" instead of saving the file to Files
      // (browsers that do not show text/calendar still save it, under this name). ASCII file
      // name: the uuid prefix keeps several files apart. Not yet tried on a real phone.
      "Content-Disposition": `inline; filename="matzati-sale-${sale.id.slice(0, 8)}.ics"`,
      // Dates can change until the sale starts; a new download always gets the current ones.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
