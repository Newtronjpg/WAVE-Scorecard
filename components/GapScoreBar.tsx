export function GapScoreBar({
  name,
  score,
}: {
  name: string;
  score: number;
}) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-medium text-ink">{name}</span>
        <span className="font-display text-lg text-ink">{score}/100</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-[var(--color-tier-poor)] overflow-hidden">
        <div
          className="h-full rounded-full bg-maroon transition-[width] duration-500"
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-ink-muted">
        Gap to close: {100 - score} points
      </div>
    </div>
  );
}
