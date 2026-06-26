import { Link } from 'react-router-dom'

export default function Logo({ className = '' }) {
  return (
    <Link to="/" className={`group flex items-center gap-2.5 ${className}`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-ember font-sans text-[13px] font-extrabold tracking-tight text-ink">
        WCE
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-sans text-[14px] font-extrabold uppercase tracking-tight text-bone">
          Western Conference
        </span>
        <span className="font-sans text-[14px] font-extrabold uppercase tracking-tight text-ember">
          Elitists
        </span>
      </span>
    </Link>
  )
}
