export default function SectionHeading({ eyebrow, title, subtitle, align = 'left' }) {
  const alignClass = align === 'center' ? 'items-center text-center mx-auto' : 'items-start text-left'
  return (
    <div className={`flex max-w-2xl flex-col gap-3 ${alignClass}`}>
      {eyebrow && (
        <span className="font-mono-tight text-xs font-semibold uppercase tracking-[0.2em] text-navy">
          {eyebrow}
        </span>
      )}
      <h2 className="text-display text-3xl text-ink sm:text-4xl">{title}</h2>
      {subtitle && <p className="text-base leading-relaxed text-faintd">{subtitle}</p>}
    </div>
  )
}
