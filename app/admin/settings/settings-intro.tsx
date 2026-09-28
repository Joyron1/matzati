/** The heading of /admin/settings and what the page is for (the dev preview shows it too). */
export function SettingsIntro() {
  return (
    <div className="space-y-2">
      <h1 className="font-display text-4xl">הגדרות</h1>
      <p className="max-w-2xl text-muted">הגדרות האתר. הן חלות על כל המבקרים.</p>
    </div>
  );
}
