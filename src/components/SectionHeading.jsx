export default function SectionHeading({ eyebrow, title, subtitle, align = 'left' }) {
  const centered = align === 'center'
  return (
    <div
      className={`flex max-w-2xl flex-col ${
        centered ? 'mx-auto items-center text-center' : 'items-start text-left'
      }`}
    >
      <span className="rule-gold" aria-hidden="true" />
      {eyebrow && <span className="kicker mt-4 text-navy">{eyebrow}</span>}
      <h2 className="text-display mt-3 text-[28px] leading-[1.15] text-ink sm:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-[15px] leading-relaxed text-muted">{subtitle}</p>
      )}
    </div>
  )
}
