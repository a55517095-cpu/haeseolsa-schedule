import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Notice, Spinner } from '../components/ui'
import { DEFAULT_PIN } from '../components/ChangePinModal'
import {
  adminCreateMember, adminLinkMember, adminResetPin, adminSetActive, friendlyError,
} from '../lib/api'
import type { Member } from '../lib/types'

export default function AdminMembers({ onBack }: { onBack: () => void }) {
  const { members, refresh, showToast } = useApp()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = useMemo(
    () => [...members]
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ko')),
    [members],
  )

  const noAccount = members.filter((m) => m.active && !m.auth_user_id)

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(null)
    try {
      await fn()
      await refresh()
      showToast(message)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  /** 계정 없는 사람 전원에게 한 번에 계정을 만들어 준다 (비밀번호는 모두 0000) */
  const linkAll = async () => {
    if (!confirm(
      `계정이 없는 ${noAccount.length}명에게 계정을 만듭니다.
` +
      `모두의 처음 비밀번호는 ${DEFAULT_PIN} 입니다. 계속할까요?`,
    )) return

    setBusy(true); setError(null)
    const failed: string[] = []
    for (const m of noAccount) {
      try {
        await adminLinkMember(m.id, DEFAULT_PIN)
      } catch (e) {
        failed.push(`${m.name}(${friendlyError(e)})`)
      }
    }
    await refresh()
    setBusy(false)
    if (failed.length) setError(`${failed.length}명은 만들지 못했습니다 — ${failed.join(', ')}`)
    else showToast(`${noAccount.length}명의 계정을 만들었습니다. 비밀번호는 모두 ${DEFAULT_PIN} 입니다.`)
  }

  if (busy) return <Spinner />

  return (
    <>
      <button className="btn ghost small" style={{ marginBottom: 14 }} onClick={onBack}>← 더보기</button>

      {error && <Notice kind="error">{error}</Notice>}

      {noAccount.length > 0 && (
        <>
          <Notice kind="warn">
            아직 로그인 계정이 없는 사람이 {noAccount.length}명 있습니다.
            처음 비밀번호는 모두 {DEFAULT_PIN} 이고, 본인이 로그인하면 바꾸라는 안내가 뜹니다.
          </Notice>
          <button className="btn" style={{ marginBottom: 16 }} onClick={() => void linkAll()}>
            {noAccount.length}명 계정 한 번에 만들기 (비밀번호 {DEFAULT_PIN})
          </button>
        </>
      )}

      <button className="btn" style={{ marginBottom: 16 }} onClick={() => setAdding(true)}>
        해설사 추가하기
      </button>

      <ul className="list">
        {list.map((m) => (
          <li key={m.id} style={{ opacity: m.active ? 1 : 0.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 800 }}>{m.name}</span>
              {m.role === 'admin' && <span className="badge today">관리자</span>}
              {m.weekend_only && <span className="badge weekend">주말</span>}
              {!m.auth_user_id && <span className="badge closed">계정 없음</span>}
              {!m.active && <span className="badge closed">사용 중지</span>}
            </div>
            {m.group_label && <div className="log-sub">{m.group_label}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {!m.auth_user_id ? (
                <button
                  className="btn small"
                  onClick={() => {
                    if (!confirm(`${m.name} 님의 계정을 만듭니다. 처음 비밀번호는 ${DEFAULT_PIN} 입니다.`)) return
                    void run(
                      () => adminLinkMember(m.id, DEFAULT_PIN),
                      `${m.name} 님의 계정을 만들었습니다. 비밀번호는 ${DEFAULT_PIN} 입니다.`,
                    )
                  }}
                >
                  계정 만들기
                </button>
              ) : (
                <button
                  className="btn ghost small"
                  onClick={() => {
                    if (!confirm(`${m.name} 님의 비밀번호를 ${DEFAULT_PIN} 으로 되돌립니다. 계속할까요?`)) return
                    void run(
                      () => adminResetPin(m.id, DEFAULT_PIN),
                      `${m.name} 님의 비밀번호를 ${DEFAULT_PIN} 으로 되돌렸습니다.`,
                    )
                  }}
                >
                  PIN 초기화
                </button>
              )}
              <button
                className={`btn small ${m.active ? 'danger-outline' : 'secondary'}`}
                onClick={() => void run(
                  () => adminSetActive(m.id, !m.active),
                  m.active ? `${m.name} 님을 사용 중지했습니다.` : `${m.name} 님을 다시 사용합니다.`,
                )}
              >
                {m.active ? '사용 중지' : '다시 사용'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {adding && (
        <AddMemberModal
          onClose={() => setAdding(false)}
          onSaved={async (name) => {
            setAdding(false)
            await refresh()
            showToast(`${name} 님을 추가했습니다.`)
          }}
        />
      )}
    </>
  )
}

function AddMemberModal({
  onClose, onSaved,
}: { onClose: () => void; onSaved: (name: string) => Promise<void> }) {
  const { members } = useApp()
  const [name, setName] = useState('')
  const [weekendOnly, setWeekendOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 사용자는 절대 입력하지 않는 내부 식별자를 자동으로 만든다 (g01, g02, ...) */
  const suggestCode = () => {
    const used = new Set(members.map((m) => m.login_code))
    for (let i = 1; i < 500; i++) {
      const code = `g${String(i).padStart(2, '0')}`
      if (!used.has(code)) return code
    }
    return `g${Date.now()}`
  }

  const submit = async () => {
    if (!name.trim()) return setError('이름을 입력해 주세요.')
    if (members.some((m) => m.name === name.trim() && m.active))
      return setError('같은 이름이 이미 명단에 있습니다.')

    setBusy(true); setError(null)
    try {
      await adminCreateMember({
        name: name.trim(),
        login_code: suggestCode(),
        pin: DEFAULT_PIN,
        weekend_only: weekendOnly,
      })
      await onSaved(name.trim())
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="해설사 추가" subtitle="이름만 넣으면 됩니다." onClose={onClose}>
      {error && <Notice kind="error">{error}</Notice>}

      <div className="field">
        <label htmlFor="new-name">이름</label>
        <input id="new-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="help" style={{ marginBottom: 4 }}>
        처음 비밀번호는 <b>{DEFAULT_PIN}</b> 입니다.
        본인이 처음 로그인하면 바꾸라는 안내가 뜨고, [더보기]에서 언제든 바꿀 수 있습니다.
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 'var(--tap)', fontWeight: 700 }}>
        <input
          type="checkbox" checked={weekendOnly}
          onChange={(e) => setWeekendOnly(e.target.checked)}
          style={{ width: 26, height: 26, minHeight: 0 }}
        />
        주말에만 근무하는 분입니다
      </label>

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose} disabled={busy}>그만두기</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? '추가하는 중...' : '추가하기'}</button>
      </div>
    </Modal>
  )
}
