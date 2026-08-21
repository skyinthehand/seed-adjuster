// Pre-flight duration estimate + sizeWarning (FR-003a). Interpolated from the real
// benchmark measurements in T024/T025 (tasks.md, 2026-08-21) rather than a guess:
//   32 entrants → 0.04s   128 → 0.10s   512 → 5.4s   1024 → 42.8s   2048 → 335s
// The curve is roughly cubic in this range (get_tight_group's remaining complexity — see
// seed_adjuster.py docstrings). We fit a conservative power-law estimate from those points
// and re-benchmark (T059 CI) whenever the algorithm changes, so this constant set should be
// refreshed alongside it rather than trusted forever.

const BENCHMARK_POINTS: { entrants: number; seconds: number }[] = [
  { entrants: 32, seconds: 0.04 },
  { entrants: 128, seconds: 0.1 },
  { entrants: 512, seconds: 5.44 },
  { entrants: 1024, seconds: 42.84 },
  { entrants: 2048, seconds: 335.47 },
];

// FR-003a: warn (don't block) once the estimate is "大幅に" over budget. We pick a
// conservative multiple of the 60-minute budget itself, not of a single benchmark point,
// so this stays meaningful even if the underlying curve shifts after future optimization.
const BUDGET_SECONDS = 60 * 60;
const WARNING_THRESHOLD_SECONDS = BUDGET_SECONDS * 0.5; // half the budget — "大幅に超える可能性" starts here

/** log-log linear regression (power law fit y = a * x^b) over the benchmark points. */
function fitPowerLaw(): { a: number; b: number } {
  const xs = BENCHMARK_POINTS.map((p) => Math.log(p.entrants));
  const ys = BENCHMARK_POINTS.map((p) => Math.log(Math.max(p.seconds, 0.001)));
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  const b =
    xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0) /
    xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const a = Math.exp(meanY - b * meanX);
  return { a, b };
}

const { a, b } = fitPowerLaw();

export function estimateDurationSeconds(entrantCount: number): number {
  if (entrantCount <= 0) return 0;
  return a * Math.pow(entrantCount, b);
}

export interface SizeWarning {
  reason: string;
  estimatedDurationSeconds: number;
  entrantCount: number;
}

/** Never rejects (FR-003a) — only informs. */
export function computeSizeWarning(entrantCount: number): SizeWarning | null {
  const estimatedDurationSeconds = estimateDurationSeconds(entrantCount);
  if (estimatedDurationSeconds <= WARNING_THRESHOLD_SECONDS) return null;
  return {
    reason:
      "参加者数が多いため、想定処理時間が長くなる可能性があります。実行中はこのタブを開いたままにしてください。",
    estimatedDurationSeconds,
    entrantCount,
  };
}
