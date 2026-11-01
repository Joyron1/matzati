"use client";

// Shows its children (keyed <li> items) in a random order chosen once per page load in the browser
// (owner request 2026-11-01: the recommended products in another order on every visit, while the
// home page itself is cached an hour). The server HTML and the hydration keep the server's order;
// the shuffle follows right after. `trailing` stays last (the "לכל המומלצים" tile).
import { Children, type ReactNode, useSyncExternalStore } from "react";
import { seededRandom, shuffled } from "@/lib/shuffle";

let pageSeed: number | null = null;
function clientSeed(): number {
  pageSeed ??= Math.random();
  return pageSeed;
}
const subscribe = () => () => {};
const serverSeed = () => null;

export function ShuffledItems({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  const seed = useSyncExternalStore(subscribe, clientSeed, serverSeed);
  const items = Children.toArray(children);
  return (
    <>
      {seed === null ? items : shuffled(items, seededRandom(seed))}
      {trailing}
    </>
  );
}
