// "המוצרים ששמרתי" (owner request 2026-10-24): products the visitor saved with the heart on a card
// or a product page, kept in this browser only (localStorage SAVED_KEY), with no sign-in. Never sent
// to the server and never logged. Each entry is the card's own snapshot (title, photo, price when
// saved), so /saved renders without a call; the price is labelled as the price when saved.
// Necessary storage like "החיפושים שלי" (STORAGE_INVENTORY in lib/consent/categories.ts): it
// remembers the visitor's own choices on the site, no third party reads it, and the visitor removes
// one or all of it with a click.
//
// Client-reachable: no zod (lib/consent has the same rule), the stored JSON is checked by hand.
// Every storage access is wrapped: private modes and blocked site data throw, and the feature then
// simply shows nothing.

/** The localStorage key. */
export const SAVED_KEY = "matzati_saved_products";
/** At most this many products are kept, newest first. */
export const SAVED_MAX = 100;
/** Window event the store fires after a change, so every heart and list on the page updates. */
export const SAVED_EVENT = "matzati:saved";

export interface SavedProduct {
  /** AliExpress product id (digits). */
  id: string;
  /** The title the card showed (ours in Hebrew, else AliExpress's). */
  title: string;
  /** The card's photo (AliExpress's image host), or "" when it had none. */
  image: string;
  /** The ILS price when saved. */
  price: number;
  /** The struck original price when saved, if any. */
  original: number | null;
  /** When it was saved, ms since the epoch. */
  at: number;
}

const MAX_TITLE = 300;

function clean(item: unknown): SavedProduct | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^\d{6,20}$/.test(o.id)) return null;
  if (typeof o.title !== "string" || !o.title.trim()) return null;
  if (typeof o.price !== "number" || !Number.isFinite(o.price) || o.price < 0) return null;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  const image =
    typeof o.image === "string" && /^https:\/\/[^\s"'<>]+$/.test(o.image) ? o.image : "";
  const original =
    typeof o.original === "number" && Number.isFinite(o.original) && o.original > o.price
      ? o.original
      : null;
  return {
    id: o.id,
    title: o.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE),
    image,
    price: o.price,
    original,
    at: o.at,
  };
}

/** The stored list, read defensively: anything malformed is dropped, never thrown. */
export function parseSaved(raw: string | null): SavedProduct[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data
    .map(clean)
    .filter((p): p is SavedProduct => p !== null)
    .sort((a, b) => b.at - a.at)
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .slice(0, SAVED_MAX);
}

/** The list with `product` first (an older entry of it replaced), at most SAVED_MAX. */
export function addSaved(
  list: readonly SavedProduct[],
  product: Omit<SavedProduct, "at">,
  at: number,
): SavedProduct[] {
  const entry = clean({ ...product, at });
  if (!entry) return [...list];
  return [entry, ...list.filter((p) => p.id !== entry.id)].slice(0, SAVED_MAX);
}

export function removeSaved(list: readonly SavedProduct[], id: string): SavedProduct[] {
  return list.filter((p) => p.id !== id);
}

// --- Browser storage -----------------------------------------------------------------------------

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked site data
  }
}

/** The stored list; [] when storage is unavailable or holds something else. */
export function readSaved(store: Storage | null = storage()): SavedProduct[] {
  if (!store) return [];
  try {
    return parseSaved(store.getItem(SAVED_KEY));
  } catch {
    return [];
  }
}

function write(list: readonly SavedProduct[], store: Storage | null): void {
  if (!store) return;
  try {
    if (list.length) store.setItem(SAVED_KEY, JSON.stringify(list));
    else store.removeItem(SAVED_KEY);
  } catch {
    // Full or blocked storage: the feature just remembers less.
  }
  try {
    window.dispatchEvent(new Event(SAVED_EVENT));
  } catch {
    // Outside a browser (tests with a fake store).
  }
}

/** Saves a product now (or moves it to the top). */
export function saveProduct(
  product: Omit<SavedProduct, "at">,
  store: Storage | null = storage(),
): void {
  write(addSaved(readSaved(store), product, Date.now()), store);
}

/** Forgets one product. */
export function forgetProduct(id: string, store: Storage | null = storage()): void {
  write(removeSaved(readSaved(store), id), store);
}

/** Forgets every saved product. */
export function clearSaved(store: Storage | null = storage()): void {
  write([], store);
}

// --- Subscription (useSyncExternalStore) ---------------------------------------------------------

export function subscribeSaved(onChange: () => void): () => void {
  // Another tab changes the list ("storage"), or this page does (SAVED_EVENT).
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SAVED_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SAVED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SAVED_EVENT, onChange);
  };
}

/** The stored text (a stable snapshot: a string compares by value). */
export function savedText(): string | null {
  try {
    return window.localStorage.getItem(SAVED_KEY);
  } catch {
    return null; // private mode or blocked site data
  }
}

/** The server's snapshot: nothing is known there. */
export const serverSavedText = (): string | null => null;
