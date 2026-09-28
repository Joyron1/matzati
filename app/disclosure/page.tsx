import { permanentRedirect } from "next/navigation";
import { AFFILIATE_SECTION_ID, LEGAL_PATHS } from "@/lib/config/legal";

// The affiliate disclosure moved into the terms (owner decision 2026-09-28). Old links and search
// results keep working: a permanent (308) redirect to that section.
export default function DisclosurePage() {
  permanentRedirect(`${LEGAL_PATHS.terms}#${AFFILIATE_SECTION_ID}`);
}
