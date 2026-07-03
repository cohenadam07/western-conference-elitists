export default function FilterChips({ options, active, onChange, label = 'Filter' }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          aria-pressed={active === opt}
          className={`rounded-full border px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition-all duration-200 ${
            active === opt
              ? 'border-navy bg-navy text-white shadow-[0_4px_10px_-4px_rgba(24,43,71,0.5)]'
              : 'border-line bg-surface text-muted hover:border-gold hover:text-ink'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}
