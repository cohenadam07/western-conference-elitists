const GRADE_COLORS = {
  'A': 'text-green border-green/40 bg-green/10',
  'A-': 'text-green border-green/40 bg-green/10',
  'B+': 'text-gold-deep border-gold/40 bg-gold/10',
  'B': 'text-gold-deep border-gold/40 bg-gold/10',
  'B-': 'text-muted border-line bg-paper',
}

export default function ProspectCard({ prospect }) {
  return (
    <div className="card-hover group flex flex-col rounded-md border border-line bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-display text-4xl text-navy">
            {String(prospect.rank).padStart(2, '0')}
          </span>
          <div>
            <h3 className="text-display text-xl text-ink">{prospect.name}</h3>
            <p className="kicker mt-1 text-faint">
              {prospect.school} · {prospect.position}
            </p>
          </div>
        </div>
        <span
          className={`rounded-sm border px-2 py-1 font-mono-tight text-xs font-semibold ${
            GRADE_COLORS[prospect.grade] || GRADE_COLORS['B-']
          }`}
        >
          {prospect.grade}
        </span>
      </div>

      {prospect.tag && (
        <span className="mt-3 w-fit rounded-sm bg-green/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-green">
          ▲ {prospect.tag}
        </span>
      )}

      <p className="mt-4 text-sm leading-relaxed text-muted">{prospect.summary}</p>

      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-line-soft pt-4 text-center font-mono-tight text-xs">
        {[
          ['HT', prospect.height],
          ['WS', prospect.wingspan],
          ['WT', prospect.weight],
          ['AGE', prospect.age],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-faint">{label}</p>
            <p className="mt-1 text-ink">{value}</p>
          </div>
        ))}
      </div>

      <p className="kicker mt-4 text-gold-deep">{prospect.archetype}</p>
    </div>
  )
}
