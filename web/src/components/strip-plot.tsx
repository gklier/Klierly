/**
 * Mastery strip plot: one dot per topic on a 0–100 axis, like the dot plots
 * students read in a statistics course. Topics without any answers sit in a
 * separate "not practised" lane instead of being shown as zero.
 */
export function StripPlot({ topics, height = 64 }: { topics: { name: string; score: number | null; attempts: number }[]; height?: number }) {
  const W = 600, pad = 16, axisY = height - 20;
  const practised = topics.filter((t) => t.attempts > 0 && t.score !== null);
  const untouched = topics.length - practised.length;
  const x = (score: number) => pad + score * (W - pad * 2);
  // Stack dots that would overlap.
  const placed: { cx: number; cy: number; t: (typeof practised)[number] }[] = [];
  for (const t of [...practised].sort((a, b) => a.score! - b.score!)) {
    const cx = x(t.score!);
    const level = placed.filter((p) => Math.abs(p.cx - cx) < 11).length;
    placed.push({ cx, cy: axisY - 9 - level * 11, t });
  }
  const label = practised.length
    ? `Mastery by topic: ${practised.map((t) => `${t.name} ${Math.round(t.score! * 100)}%`).join(", ")}.${untouched ? ` ${untouched} not practised yet.` : ""}`
    : "No topics practised yet.";
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="w-full" style={{ maxHeight: height * 1.6 }}>
        <line x1={pad} x2={W - pad} y1={axisY} y2={axisY} stroke="var(--line)" strokeWidth="1.5" />
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={x(v / 100)} x2={x(v / 100)} y1={axisY} y2={axisY + 4} stroke="var(--line)" strokeWidth="1.5" />
            <text x={x(v / 100)} y={axisY + 16} textAnchor="middle" fontSize="10" fill="var(--muted)" className="tnum">{v}</text>
          </g>
        ))}
        {placed.map(({ cx, cy, t }) => (
          <circle key={t.name} cx={cx} cy={cy} r="5" fill={t.score! >= 0.8 ? "var(--good)" : t.score! >= 0.5 ? "var(--accent)" : "var(--bad)"} opacity={Math.min(1, 0.45 + t.attempts * 0.11)}>
            <title>{`${t.name}: ${Math.round(t.score! * 100)}% (${t.attempts} answers)`}</title>
          </circle>
        ))}
      </svg>
      {untouched > 0 && <p className="mt-1 text-xs text-muted">{untouched} {untouched === 1 ? "topic" : "topics"} not practised yet {practised.length ? "(not shown)" : ""}</p>}
    </div>
  );
}
