// The search store an SEO page refresh runs with (refreshSearch in lib/search/server.ts): every
// read and write of the real store, except that no cached result set is ever found, so the search
// fetches new AliExpress data and explains its first page again. The parse still comes from the
// parse cache when it is there. The new result set is written as usual, so visitors' searches for
// the same filters get it too.
import type { SearchStore } from "@/lib/search/store";

export function withoutResultsCache(store: SearchStore): SearchStore {
  return {
    getParse: (queryKey, now) => store.getParse(queryKey, now),
    putParse: (queryKey, queryNorm, parsed, createdAt) =>
      store.putParse(queryKey, queryNorm, parsed, createdAt),
    getResults: async () => null,
    putResults: (filtersKey, query, results) => store.putResults(filtersKey, query, results),
    updateResults: (filtersKey, results) => store.updateResults(filtersKey, results),
    logSearch: (entry) => store.logSearch(entry),
    logUsage: (records) => store.logUsage(records),
    saveProducts: (products, titlesHe, checkedAt) =>
      store.saveProducts(products, titlesHe, checkedAt),
  };
}
