import { SPORTS } from '../lib/forms.js'

const Check = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.4l2.9 2.9 6.1-6.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * NBA / NFL / UFC toggles for Savant Sunday. Real checkboxes (keyboard and screen readers
 * get the native behaviour); the styling sits on the label.
 *
 *   variant="chips"  one compact row, for the signup form
 *   variant="cards"  one card per sport with its Savant name, for /newsletter/sports
 */
export default function SportPicker({ value, onChange, variant = 'chips', disabled = false, label = 'Sports' }) {
  const toggle = (id) => {
    const next = value.includes(id) ? value.filter((s) => s !== id) : [...value, id]
    onChange(SPORTS.map((s) => s.id).filter((s) => next.includes(s)))
  }

  if (variant === 'cards') {
    return (
      <div role="group" aria-label={label} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SPORTS.map((s) => {
          const on = value.includes(s.id)
          return (
            <label
              key={s.id}
              className={`relative flex cursor-pointer select-none items-center justify-between gap-4 rounded-md border px-5 py-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-deep ${
                on ? 'border-navy bg-navy text-white' : 'border-line bg-surface text-ink hover:border-navy/50'
              } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={() => toggle(s.id)} />
              <span>
                <span className="block font-mono text-[13px] font-semibold uppercase tracking-[0.14em]">{s.label}</span>
                <span className={`mt-1 block text-sm ${on ? 'text-white/75' : 'text-muted'}`}>{s.product}</span>
              </span>
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border ${on ? 'border-gold bg-gold text-navy' : 'border-line bg-paper text-transparent'}`}
              >
                <Check className="h-4 w-4" />
              </span>
            </label>
          )
        })}
      </div>
    )
  }

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className="mr-1 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
      {SPORTS.map((s) => {
        const on = value.includes(s.id)
        return (
          <label
            key={s.id}
            title={s.product}
            className={`inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.1em] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-deep ${
              on ? 'border-navy bg-navy text-white' : 'border-line bg-paper text-muted hover:border-navy/50 hover:text-navy'
            } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input type="checkbox" className="sr-only" checked={on} disabled={disabled} onChange={() => toggle(s.id)} />
            <Check className={`h-3.5 w-3.5 ${on ? 'text-gold' : 'hidden'}`} />
            {s.label}
          </label>
        )
      })}
    </div>
  )
}
