import { useEffect, useRef, useState } from 'react'

export default function YearSelector({ years, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = years.find((y) => y.year === selected) ?? years[0]

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`group flex items-center gap-3 rounded-md border bg-surface-2 px-4 py-3 text-left transition-all duration-200 ${
          open ? 'border-ember shadow-[0_0_0_3px_rgba(28,63,110,0.12)]' : 'border-line hover:border-mute'
        }`}
      >
        <span className="flex flex-col leading-tight">
          <span className="flex items-center gap-2">
            <span className="text-display text-lg text-bone">{current.label}</span>
            {current.status === 'On the Board' && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foul opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-foul" />
              </span>
            )}
          </span>
          <span className="font-mono-tight text-xs text-mute">{current.sublabel}</span>
        </span>
        <svg
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          className={`ml-1 shrink-0 text-mute transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div
        className={`absolute left-0 top-full z-30 mt-2 w-72 origin-top-left overflow-hidden rounded-md border border-line bg-surface-2 shadow-xl transition-all duration-150 ${
          open ? 'visible scale-100 opacity-100' : 'invisible scale-95 opacity-0'
        }`}
      >
        {years.map((y) => (
          <button
            key={y.year}
            onClick={() => {
              onChange(y.year)
              setOpen(false)
            }}
            className={`flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3.5 text-left transition-colors last:border-b-0 ${
              y.year === selected ? 'bg-surface-3' : 'hover:bg-surface-3'
            }`}
          >
            <span>
              <span className="block text-sm font-bold text-bone">{y.label}</span>
              <span className="block font-mono-tight text-xs text-mute">{y.sublabel}</span>
            </span>
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                y.status === 'On the Board' ? 'bg-foul/10 text-foul' : 'bg-surface-3 text-mute'
              }`}
            >
              {y.status}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
