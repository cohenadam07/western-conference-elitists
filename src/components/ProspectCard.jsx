const GRADE_COLORS = {
  'A': 'text-green border-green/40 bg-green/10',
  'A-': 'text-green border-green/40 bg-green/10',
  'B+': 'text-gold-deep border-gold/40 bg-gold/10',
  'B': 'text-gold-deep border-gold/40 bg-gold/10',
  'B-': 'text-faintd border-line bg-paper',
}

export default function ProspectCard({ prospect }) {
  return (
    <div className="card-hover group flex flex-col rounded-md border border-line bg-surface p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-display text-4xl text-navy">
            {String(prospect.rank).padStart(2, '0')}
          </span>
          <div>
            <h3 className="text-lg font-bold text-ink">{prospect.name}</h3>
            <p className="text-xs uppercase tracking-wide text-faint">
              {prospect.school} · {prospect.position}
            </p>
          </div>
        </div>
        <span
          className={`rounded-sm border px-2 py-1 font-mono-tight text-xs font-bold ${
            GRADE_COLORS[prospect.grade] || GRADE_COLORS['B-']
          }`}
        >
          {prospect.grade}
        </span>
      </div>

      {prospect.tag && (
        <span className="mt-3 w-fit rounded-sm bg-green/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-green">
          ▲ {prospect.tag}
        </span>
      )}

      <p className="mt-4 text-sm leading-relaxed text-faintd">{prospect.summary}</p>

      <div className="mt-5 grid grid-cols-4 gap-2 border-t border-line pt-4 font-mono-tight text-center text-xs">
        <div>
          <p className="text-faint">HT</p>
          <p className="mt-1 text-ink">{prospect.height}</p>
        </div>
        <div>
          <p className="text-faint">WS</p>
          <p className="mt-1 text-ink">{prospect.wingspan}</p>
        </div>
        <div>
          <p className="text-faint">WT</p>
          <p className="mt-1 text-ink">{prospect.weight}</p>
        </div>
        <div>
          <p className="text-faint">AGE</p>
          <p className="mt-1 text-ink">{prospect.age}</p>
        </div>
      </div>

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-navy">
        {prospect.archetype}
      </p>
    </div>
  )
}
