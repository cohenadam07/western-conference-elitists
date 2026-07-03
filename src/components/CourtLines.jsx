/**
 * Editorial half-court line art — the site's signature image treatment
 * for pieces that have no photography. Strokes inherit currentColor;
 * the rim and free-throw arc pick up the gold accent.
 */
export default function CourtLines({ className = '', accent = 'var(--color-gold)' }) {
  return (
    <svg
      viewBox="0 0 500 470"
      fill="none"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="xMidYMid slice"
    >
      <g stroke="currentColor" strokeWidth="2">
        {/* Court boundary */}
        <rect x="6" y="6" width="488" height="458" />
        {/* Lane */}
        <rect x="170" y="6" width="160" height="184" />
        {/* Backboard + restricted arc */}
        <line x1="220" y1="46" x2="280" y2="46" />
        <path d="M210 58 A40 40 0 0 0 290 58" />
        {/* Three-point line */}
        <path d="M36 6 V140 A218 218 0 0 0 464 140 V6" />
        {/* Free-throw circle, dashed lower half */}
        <path d="M190 190 A60 60 0 0 0 310 190" strokeDasharray="10 9" />
        {/* Half-court circle */}
        <path d="M190 464 A60 60 0 0 1 310 464" />
      </g>
      {/* Rim + free-throw arc in gold */}
      <circle cx="250" cy="60" r="9" stroke={accent} strokeWidth="2.5" />
      <path d="M190 190 A60 60 0 0 1 310 190" stroke={accent} strokeWidth="2.5" />
    </svg>
  )
}
