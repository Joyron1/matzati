"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { ConsentGate } from "@/components/cookie-consent/consent-gate";
import { consentAllows, consentNotice } from "@/lib/consent/consent";
import { useConsent } from "@/lib/consent/use-consent";
import { browserFbq, metaCookieDeletions, metaPageAllowed } from "./fbq";

/**
 * Mounted only while the visitor accepts marketing (inside ConsentGate): loads fbevents.js on the
 * first page Meta may see and sends one PageView per route change, only for pages whose address
 * holds no visitor text (metaPageAllowed). Unmounting (consent withdrawn) revokes and deletes the
 * Meta cookies.
 */
function PixelTracker({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = search ? `${pathname}?${search}` : pathname;
  const allowed = metaPageAllowed(pathname, search);

  useEffect(() => {
    browserFbq(pixelId).pageView(route, allowed);
  }, [pixelId, route, allowed]);

  // The gate unmounts this when the visitor withdraws marketing consent.
  useEffect(() => () => browserFbq(pixelId).revoke(), [pixelId]);

  return null;
}

/**
 * Outside the gate, sends nothing and loads nothing: on every page of a visitor whose choice is
 * known and does not include marketing, deletes Meta cookies left from before (an earlier consent
 * in another tab, or a choice made under another notice).
 */
function LeftoverCookies({ analyticsInUse }: { analyticsInUse: boolean }) {
  const { consent } = useConsent(consentNotice(analyticsInUse, true));
  const pathname = usePathname();
  const known = consent !== undefined;
  const allowed = consentAllows(consent, "marketing");
  useEffect(() => {
    if (!known || allowed) return;
    for (const cookie of metaCookieDeletions(document.cookie, window.location.hostname)) {
      document.cookie = cookie;
    }
  }, [known, allowed, pathname]);
  return null;
}

/**
 * The Meta Pixel for the id the owner set in /admin/settings (CLAUDE.md §7 "Meta Pixel"). The root
 * layout renders it only while an id is set; the pixel itself renders only inside
 * <ConsentGate category="marketing"> under the page's notice (strict: nothing before consent, no
 * cookieless mode). `analyticsInUse`: Google Analytics is configured too, which picks the notice.
 * Renders no HTML.
 */
export function MetaPixel({
  pixelId,
  analyticsInUse,
}: {
  pixelId: string;
  analyticsInUse: boolean;
}) {
  return (
    <>
      <ConsentGate category="marketing" notice={consentNotice(analyticsInUse, true)}>
        {/* useSearchParams: rendered in the browser only (the gate), the boundary keeps it local. */}
        <Suspense fallback={null}>
          <PixelTracker pixelId={pixelId} />
        </Suspense>
      </ConsentGate>
      <LeftoverCookies analyticsInUse={analyticsInUse} />
    </>
  );
}
