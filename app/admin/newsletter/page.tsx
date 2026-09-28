import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import { StateCard } from "@/components/state-card";
import { requireAdmin } from "@/lib/admin/auth";
import { loadNewsletterOverview, type NewsletterOverview } from "@/lib/newsletter/admin";
import { firstParam } from "@/lib/search-url";
import { NewsletterAdminView } from "./newsletter-admin-view";

export const metadata: Metadata = {
  title: "ניוזלטר", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

export default async function AdminNewsletterPage({
  searchParams,
}: PageProps<"/admin/newsletter">) {
  // The layout guards /admin too, but it does not re-run on client navigation.
  await requireAdmin();
  const requested = Number.parseInt(firstParam((await searchParams).page), 10);

  let data: NewsletterOverview | null = null;
  try {
    data = await loadNewsletterOverview(Number.isFinite(requested) ? requested : 1);
  } catch (err) {
    // Name and message only, never rows.
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-newsletter] ${text.slice(0, 300)}`);
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12">
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את רשימת התפוצה">
          <p className="max-w-prose text-muted">
            נסו לרענן את הדף בעוד רגע. אם זו הפעם הראשונה, ודאו שהמיגרציה{" "}
            <bdi dir="ltr" className="font-mono">
              newsletter
            </bdi>{" "}
            הוחלה על מסד הנתונים.
          </p>
        </StateCard>
      </div>
    );
  }
  return <NewsletterAdminView data={data} />;
}
