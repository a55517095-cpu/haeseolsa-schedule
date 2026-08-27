import { useEffect, type ReactNode } from 'react'

export function Spinner() {
  return <div className="spinner" role="status" aria-label="불러오는 중" />
}

export function Notice({
  kind = 'info', children,
}: { kind?: 'info' | 'error' | 'ok' | 'warn'; children: ReactNode }) {
  return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>
}

export function Empty({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <span className="big" aria-hidden="true">{icon}</span>
      {title}
      {hint && <div className="help" style={{ marginTop: 10 }}>{hint}</div>}
    </div>
  )
}

export function Modal({
  title, subtitle, onClose, children,
}: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {subtitle && <div className="modal-sub">{subtitle}</div>}
        {children}
      </div>
    </div>
  )
}

export function MonthPicker({
  year, month, onChange,
}: { year: number; month: number; onChange: (year: number, month: number) => void }) {
  const step = (delta: number) => {
    const total = year * 12 + (month - 1) + delta
    onChange(Math.floor(total / 12), (total % 12) + 1)
  }
  return (
    <div className="month-picker">
      <button onClick={() => step(-1)} aria-label="이전 달">‹</button>
      <div className="label">{year}년 {month}월</div>
      <button onClick={() => step(1)} aria-label="다음 달">›</button>
    </div>
  )
}

/** 조 선택 (1조 / 2조) */
export function TeamTabs({
  teams, value, onChange,
}: { teams: { id: number; name: string }[]; value: number; onChange: (id: number) => void }) {
  return (
    <div className="tabs" role="tablist">
      {teams.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
        >
          {t.name}
        </button>
      ))}
    </div>
  )
}
