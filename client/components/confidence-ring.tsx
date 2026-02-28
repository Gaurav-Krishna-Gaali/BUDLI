export function ConfidenceRing({ score }: { score: number }) {
  const r = 18
  const circumference = 2 * Math.PI * r
  const dashOffset = circumference - (score / 100) * circumference
  const color = score >= 75 ? "oklch(0.52 0.165 152)" : score >= 55 ? "oklch(0.78 0.155 72)" : "oklch(0.577 0.245 27.325)"

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="oklch(0.9 0 0)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="absolute text-xs font-bold text-foreground">{score}%</span>
    </div>
  )
}
