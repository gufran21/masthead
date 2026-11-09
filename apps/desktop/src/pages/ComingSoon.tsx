const COPY: Record<string, { title: string; text: string }> = {
  cleanup: { title: "Cleanup", text: "Find caches and stale node_modules, preview them, and move them to the Recycle Bin." },
  doctor: { title: "Doctor", text: "Read-only health checks for your dev setup, each with an explicit fix." },
  notch: { title: "Notch", text: "Design the pill and peek card that sit at the top of your screen." },
};

export function ComingSoon({ page }: { page: string }) {
  const copy = COPY[page] ?? { title: page, text: "" };
  return (
    <div className="coming">
      <h1>{copy.title}</h1>
      <p>{copy.text}</p>
      <p style={{ marginTop: 10, color: "var(--text-3)" }}>Coming in a later release.</p>
    </div>
  );
}
