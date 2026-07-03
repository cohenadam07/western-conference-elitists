/**
 * Standard page masthead: gold rule, mono kicker, Newsreader headline,
 * optional lede and a right-aligned slot (e.g. a year selector).
 */
export default function PageHeader({ eyebrow, title, lede, children, center = false }) {
  return (
    <section className="border-b border-line bg-wash">
      <div
        className={`mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-20 ${
          center ? 'flex flex-col items-center text-center' : ''
        }`}
      >
        <div
          className={
            children
              ? 'flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between'
              : undefined
          }
        >
          <div className={center ? 'flex max-w-3xl flex-col items-center' : 'max-w-3xl'}>
            <span className="rule-gold" aria-hidden="true" />
            {eyebrow && <span className="kicker mt-4 block text-navy">{eyebrow}</span>}
            <h1 className="text-display mt-4 text-[34px] leading-[1.08] text-ink sm:text-5xl lg:text-[54px]">
              {title}
            </h1>
            {lede && (
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{lede}</p>
            )}
          </div>
          {children}
        </div>
      </div>
    </section>
  )
}
