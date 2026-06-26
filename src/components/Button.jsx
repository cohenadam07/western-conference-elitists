import { Link } from 'react-router-dom'

const VARIANTS = {
  primary: 'bg-ember text-ink hover:bg-ember-dim',
  secondary:
    'bg-transparent text-bone border border-line hover:border-mute hover:bg-surface-3',
  ghost:
    'bg-transparent text-bone-dim hover:text-bone',
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
    'inline-flex items-center justify-center gap-2 rounded-sm px-6 py-3 text-sm font-semibold uppercase tracking-wider transition-all duration-300'
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
