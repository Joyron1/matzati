import { NextResponse } from "next/server";
import { getMockProduct } from "@/lib/mock/products";

// Click-out. M4 replaces the mock lookup with the products table, logs
// { product_id, src, ts } to `clicks`, and redirects to the product's affiliate link.
export async function GET(_request: Request, ctx: RouteContext<"/go/[productId]">) {
  const { productId } = await ctx.params;
  if (!getMockProduct(productId)) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.redirect("https://www.aliexpress.com/", 302);
}
