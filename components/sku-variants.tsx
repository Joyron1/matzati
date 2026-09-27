import type { ReactNode } from "react";
import type { AliSku, AliSkuDetails } from "@/lib/aliexpress/schemas";
import { formatIls } from "@/lib/format";
import { ProductImage } from "./product-image";
import { card } from "./styles";

// Colors and sizes from product.sku.detail.get, rendered on /p only while SKU_DETAILS_ENABLED is
// on. Display only: the visitor picks a variant on AliExpress, and the buy button stays /go (a
// SKU's own link has no tracking id and is never used).

const regionNames = new Intl.DisplayNames(["he"], { type: "region" });

/** "CN" → "סין"; anything that is not a two-letter region code is shown as sent. */
function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return code;
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

interface VariantOption {
  label: string;
  image: string | null;
}

/**
 * Distinct values in SKU order. Colors get the first SKU photo found for them; sizes get none, since
 * a SKU photo shows its color and would mislead next to a size.
 */
function variantOptions(skus: AliSku[], key: "color" | "size"): VariantOption[] {
  const seen = new Map<string, string | null>();
  for (const s of skus) {
    const label = s[key];
    if (label && !seen.get(label)) seen.set(label, key === "color" ? s.imageUrl : null);
  }
  return [...seen].map(([label, image]) => ({ label, image }));
}

const present = (n: number | null): n is number => n !== null;

/** "3–7 ימים" (the range kept left to right), "יום אחד", "יומיים", "5 ימים". */
function daysText(min: number, max: number): ReactNode {
  if (min !== max) {
    return (
      <>
        <bdi dir="ltr">
          {min}–{max}
        </bdi>{" "}
        ימים
      </>
    );
  }
  if (min === 1) return "יום אחד";
  if (min === 2) return "יומיים";
  return `${min} ימים`;
}

function OptionChips({ title, options }: { title: string; options: VariantOption[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted">{title}</h3>
      <ul className="flex flex-wrap gap-2">
        {options.map((o) => (
          <li
            key={o.label}
            className={`inline-flex max-w-full items-center gap-2 rounded-full border border-line py-1 pe-3 text-sm ${
              o.image ? "ps-1" : "ps-3"
            }`}
          >
            {o.image && (
              <ProductImage
                src={o.image}
                alt=""
                className="size-8 shrink-0 rounded-full"
                iconClassName="size-4"
                sizes="32px"
              />
            )}
            <span className="min-w-0 truncate">
              <bdi>{o.label}</bdi>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-1 rounded-tile bg-surface-2 p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-bold">{children}</dd>
    </div>
  );
}

export function SkuVariants({
  details,
  className = "",
}: {
  details: AliSkuDetails;
  className?: string;
}) {
  const { skus } = details;
  const colors = variantOptions(skus, "color");
  const sizes = variantOptions(skus, "size");
  // Prices are compared in ILS only (CLAUDE.md §6.5).
  const prices = skus
    .filter((s) => s.currency === "ILS")
    .map((s) => s.price)
    .filter(present);
  const minDays = skus.map((s) => s.minDeliveryDays).filter(present);
  const maxDays = skus.map((s) => s.maxDeliveryDays).filter(present);
  const shipFrom = [...new Set(skus.map((s) => s.shipFrom).filter((c): c is string => !!c))];
  if (!colors.length && !sizes.length && !prices.length) return null;

  const [low, high] = [Math.min(...prices), Math.max(...prices)];
  const [fastest, slowest] = [Math.min(...minDays), Math.max(...maxDays)];
  return (
    <section aria-labelledby="sku-title" className={`${card} space-y-5 p-5 sm:p-6 ${className}`}>
      <h2 id="sku-title" className="font-display text-2xl">
        צבעים ומידות
      </h2>
      {colors.length > 0 && <OptionChips title="צבעים" options={colors} />}
      {sizes.length > 0 && <OptionChips title="מידות" options={sizes} />}
      <dl className="grid gap-3 sm:grid-cols-3">
        {prices.length > 0 && (
          <Fact label="מחיר לפי צבע ומידה">
            <bdi dir="ltr">
              {low === high
                ? formatIls(low, false)
                : `${formatIls(low, false)}–${formatIls(high, false)}`}
            </bdi>
          </Fact>
        )}
        {minDays.length > 0 && maxDays.length > 0 && (
          <Fact label="זמן משלוח משוער לישראל">
            {daysText(fastest, Math.max(fastest, slowest))}
          </Fact>
        )}
        {shipFrom.length > 0 && <Fact label="נשלח מ־">{shipFrom.map(countryName).join(", ")}</Fact>}
      </dl>
      <p className="text-xs leading-relaxed text-muted">
        הנתונים מאלי אקספרס. את הצבע והמידה בוחרים בעמוד המוצר באלי אקספרס, והמחיר שמוצג שם הוא
        הקובע.
      </p>
    </section>
  );
}
