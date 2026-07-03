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
        className={`group flex items-center gap-3 rounded-md border bg-surface px-4 py-3 text-left transition-all duration-200 ${
          open ? 'border-navy shadow-[0_0_0_3px_rgba(34,57,90,0.15)]' : 'border-line hover:border-faint'
        }`}
      >
        <span className="flex flex-col leading-tight">
          <span className="flex items-center gap-2">
            <span className="text-display text-lg text-ink">{current.label}</span>
            {current.status === 'On the Board' && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red" />
              </span>
            )}
          </span>
          <span className="font-mono-tight text-xs text-faint">{current.sublabel}</span>
        </span>
        <svg
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          className={`ml-1 shrink-0 text-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div
        className={`absolute left-0 top-full z-30 mt-2 w-72 origin-top-left overflow-hidden rounded-md border border-line bg-surface shadow-xl transition-all duration-150 ${
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
              y.year === selected ? 'bg-paper' : 'hover:bg-paper'
            }`}
          >
            <span>
              <span className="block text-sm font-bold text-ink">{y.label}</span>
              <span className="block font-mono-tight text-xs text-faint">{y.sublabel}</span>
            </span>
            <span
              className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                y.status === 'On the Board' ? 'bg-red/10 text-red' : 'bg-paper text-faint'
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
