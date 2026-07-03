import { Link } from 'react-router-dom'

const VARIANTS = {
  primary: 'bg-navy text-white hover:bg-navy-deep',
  secondary:
    'bg-transparent text-ink border border-line hover:border-faint hover:bg-paper',
  ghost:
    'bg-transparent text-faintd hover:text-ink',
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
