import { Link } from 'react-router-dom'

export default function Logo({ className = '', light = false }) {
  return (
    <Link
      to="/"
      aria-label="Western Conference Elitists — home"
      className={`group flex items-center gap-3 ${className}`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] font-sans text-[12.5px] font-bold tracking-tight transition-colors duration-300 ${
          light ? 'bg-white text-navy' : 'bg-navy text-white group-hover:bg-navy-deep'
        }`}
      >
        WCE
      </span>
      <span className="flex flex-col leading-none">
        <span
          className={`font-sans text-[13.5px] font-bold uppercase tracking-[0.02em] ${
            light ? 'text-white' : 'text-ink'
          }`}
        >
          Western Conference
        </span>
        <span
          className={`mt-[3px] font-sans text-[13.5px] font-bold uppercase tracking-[0.02em] ${
            light ? 'text-gold' : 'text-navy'
          }`}
        >
          Elitists
        </span>
      </span>
    </Link>
  )
}
