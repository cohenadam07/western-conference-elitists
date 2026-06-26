const GRADE_COLORS = {
  'A': 'text-arena border-arena/40 bg-arena/10',
  'A-': 'text-arena border-arena/40 bg-arena/10',
  'B+': 'text-court border-court/40 bg-court/10',
  'B': 'text-court border-court/40 bg-court/10',
  'B-': 'text-bone-dim border-line bg-surface-3',
}

export default function ProspectCard({ prospect }) {
  return (
    <div className="card-hover group flex flex-col rounded-md border border-line bg-surface-2 p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-display text-4xl text-ember">
            {String(prospect.rank).padStart(2, '0')}
          </span>
          <div>
            <h3 className="text-lg font-bold text-bone">{prospect.name}</h3>
            <p className="text-xs uppercase tracking-wide text-mute">
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
        <span className="mt-3 w-fit rounded-sm bg-arena/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-arena">
          ▲ {prospect.tag}
        </span>
      )}

      <p className="mt-4 text-sm leading-relaxed text-bone-dim">{prospect.summary}</p>

      <div className="mt-5 grid grid-cols-4 gap-2 border-t border-line pt-4 font-mono-tight text-center text-xs">
        <div>
          <p className="text-mute">HT</p>
          <p className="mt-1 text-bone">{prospect.height}</p>
        </div>
        <div>
          <p className="text-mute">WS</p>
          <p className="mt-1 text-bone">{prospect.wingspan}</p>
        </div>
        <div>
          <p className="text-mute">WT</p>
          <p className="mt-1 text-bone">{prospect.weight}</p>
        </div>
        <div>
          <p className="text-mute">AGE</p>
          <p className="mt-1 text-bone">{prospect.age}</p>
        </div>
      </div>

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ember">
        {prospect.archetype}
      </p>
    </div>
  )
}
