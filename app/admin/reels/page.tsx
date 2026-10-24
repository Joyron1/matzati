import { permanentRedirect } from "next/navigation";

// The Reels panel became the Meta panel (posts, stories and Reels; owner request 2026-10-24).
export default function ReelsMoved() {
  permanentRedirect("/admin/meta");
}
