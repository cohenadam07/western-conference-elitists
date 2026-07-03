import { Link } from 'react-router-dom'

const VARIANTS = {
  primary:
    'bg-navy text-white hover:bg-navy-deep shadow-[0_1px_2px_rgba(24,43,71,0.2)] hover:shadow-[0_6px_16px_-6px_rgba(24,43,71,0.45)] hover:-translate-y-px',
  secondary:
    'bg-transparent text-ink border border-ink/20 hover:border-gold hover:bg-surface hover:-translate-y-px',
  light:
    'bg-white text-navy hover:bg-paper shadow-[0_1px_2px_rgba(24,43,71,0.25)] hover:-translate-y-px',
  ghost: 'bg-transparent text-muted hover:text-ink',
}

export default function Button({
  children,
  to,
  href,
  onClick,
  type = 'button',
  variant = 'primary',
  className = '',
  ...rest
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-sm px-6 py-3 font-mono text-[12.5px] font-medium uppercase tracking-[0.12em] transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-deep'
  const classes = `${base} ${VARIANTS[variant]} ${className}`

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {children}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <button type={type} onClick={onClick} className={classes} {...rest}>
      {children}
    </button>
  )
}
