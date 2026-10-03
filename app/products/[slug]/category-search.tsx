import Form from "next/form";
import { Search } from "lucide-react";
import { btnMd, btnPrimary } from "@/components/styles";
import type { CatalogCategory } from "@/lib/catalog/categories";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";

/**
 * "חיפוש בתכשיטים": the site's regular search, limited to the category (/search?q=…&cat=<first-level
 * id>; the pipeline sends it to product.query as category_ids, SearchInput.category). A plain GET
 * form, so it works without JavaScript.
 */
export function CategorySearch({ category }: { category: CatalogCategory }) {
  const label = `חיפוש ב${category.nameHe}`;
  return (
    // One row, no card: on a phone the first products stay close to the first screen.
    <Form action="/search" role="search" aria-label={label} className="flex items-center gap-2">
      <input type="hidden" name="cat" value={category.firstLevelId} />
      <label className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <input
          type="search"
          name="q"
          required
          maxLength={MAX_QUERY_LENGTH}
          enterKeyHint="search"
          placeholder={`${label}…`}
          className="h-12 w-full rounded-full border border-line bg-surface px-5 text-base text-ink placeholder:text-muted hover:border-accent"
        />
      </label>
      <button type="submit" className={`${btnPrimary} ${btnMd} shrink-0`}>
        <Search aria-hidden className="size-[18px]" />
        חיפוש
      </button>
    </Form>
  );
}
