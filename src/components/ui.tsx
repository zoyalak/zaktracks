import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

/* ------------------------------------------------------------------ Logo */

/** ZakTracks mark: the Black Clover five-leaf clover, in beige. */
export function CloverLogo({
  size = 26,
  className,
  style,
}: {
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* five beige heart-shaped leaves radiating from the centre */}
      {[0, 72, 144, 216, 288].map((deg) => (
        <g key={deg} transform={`rotate(${deg} 32 32)`} fill="#F2ECDF">
          {/* two round lobes + a tapering wedge: an obcordate clover leaflet */}
          <circle cx="26" cy="11.5" r="5.6" />
          <circle cx="38" cy="11.5" r="5.6" />
          <polygon points="32,33.5 42.5,11.5 21.5,11.5" />
        </g>
      ))}
      {/* small centre where the five leaf tips meet */}
      <circle cx="32" cy="32" r="3.6" fill="#F2ECDF" />
    </svg>
  )
}

/* ------------------------------------------------------------------ Sheet */

export function Sheet({
  open,
  onClose,
  title,
  sub,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  sub?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        {title && <h2>{title}</h2>}
        {sub && <p className="sheet-sub">{sub}</p>}
        {children}
      </div>
    </>
  )
}

/* ----------------------------------------------------------------- fields */

export function Field({ label, children, hint }: { label?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="tiny" style={{ marginTop: 5 }}>{hint}</div>}
    </div>
  )
}

/** Red inline reminder under a field, e.g. "Please enter your weight." */
export function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return (
    <div className="tiny" style={{ marginTop: 5, color: 'var(--danger)' }}>
      {msg}
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  placeholder,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  unit?: string
  step?: number
  min?: number
  max?: number
  placeholder?: string
}) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <div className="suffix">
        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={value}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- segmented */

export interface SegOption<T extends string> {
  value: T
  label: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Choice({
  emoji,
  title,
  desc,
  active,
  onClick,
}: {
  emoji: string
  title: string
  desc?: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button className={`choice${active ? ' active' : ''}`} onClick={onClick} type="button">
      <span className="emoji" aria-hidden>
        {emoji}
      </span>
      <span className="grow">
        <span className="t">{title}</span>
        {desc && <div className="d">{desc}</div>}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ rings */

export function ProgressRing({
  value,
  max,
  size = 132,
  stroke = 13,
  color = 'var(--accent)',
  track = 'rgba(255,255,255,0.08)',
  children,
}: {
  value: number
  max: number
  size?: number
  stroke?: number
  color?: string
  track?: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: 'stroke-dasharray .5s cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------ macro bars */

export function MacroBar({
  name,
  value,
  target,
  unit = 'g',
  tone,
  color,
  decimals = 0,
}: {
  name: string
  value: number
  target: number
  unit?: string
  /** CSS color name for the theme variables, e.g. "protein". */
  tone: string
  /** Exact CSS color, when tone isn't one of the themed macros. */
  color?: string
  decimals?: number
}) {
  const fmt = (n: number) => (decimals > 0 ? Math.round(n * 10 ** decimals) / 10 ** decimals : Math.round(n))
  const barColor = color ?? `var(--${tone})`
  const over = target > 0 && value > target
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className={over ? 'macro-bar over' : 'macro-bar'}>
      <div className="macro-bar-top">
        <span className="name" style={{ color: barColor }}>
          {name}
        </span>
        <span className="vals num">
          {fmt(value)}
          {unit} / {fmt(target)}
          {unit}
        </span>
      </div>
      <div className="track">
        <div className={`fill ${tone}`} style={{ width: `${pct}%`, background: barColor }} />
      </div>
    </div>
  )
}

/**
 * Inline pull-down section: expands downward in place (no modal) to reveal
 * secondary detail like the extended macros.
 */
export function Disclosure({
  title,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string
  hint?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={open ? 'disclosure open' : 'disclosure'}>
      <button
        type="button"
        className="disclosure-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        {hint && <span className="tiny muted">{hint}</span>}
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>
      <div className="disclosure-body">
        <div className="disclosure-inner">{children}</div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- notices */

export function Notice({
  type = 'warn',
  children,
}: {
  type?: 'warn' | 'error' | 'info'
  children: ReactNode
}) {
  const icon = type === 'error' ? '⚠️' : type === 'info' ? '💡' : '⚠️'
  return (
    <div className={`notice ${type === 'warn' ? '' : type}`}>
      <span aria-hidden>{icon}</span>
      <div>{children}</div>
    </div>
  )
}

export function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="big" aria-hidden>
        {icon}
      </span>
      {children}
    </div>
  )
}

export function Loading({ label = 'Working…' }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: '26px 0', gap: 10 }}>
      <span className="spinner" />
      <span className="muted">{label}</span>
    </div>
  )
}
