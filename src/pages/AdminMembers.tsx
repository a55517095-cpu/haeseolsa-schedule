import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Notice, Spinner, TeamTabs } from '../components/ui'
import {
  adminCreateMember, adminLinkMember, adminResetPin, adminSetActive, friendlyError,
} from '../lib/api'
import type { Member } from '../lib/types'

export default function AdminMembers({ onBack }: { onBack: () => void }) {
  const { teams, members, refresh, showToast } = useApp()
  const [teamId, setTeamId] = useState<number>(teams[0]?.id ?? 1)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = useMemo(
    () => members
      .filter((m) => m.team_id === teamId || (teamId === teams[0]?.id && m.team_id == null))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ko')),
    [members, teamId, teams],
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

  const askPin = (who: string): string | null => {
    const pin = prompt(`${who} 님의 비밀번호(PIN) 숫자 4자리를 정해주세요.`, '0000')
    if (pin == null) return null
    if (!/^\d{4}$/.test(pin)) { alert('숫자 4자리로 입력해 주세요.'); return null }
    return pin
  }

  if (busy) return <Spinner />

  return (
    <>
      <button className="btn ghost small" style={{ marginBottom: 14 }} onClick={onBack}>← 더보기</button>

      {error && <Notice kind="error">{error}</Notice>}

      {noAccount.length > 0 && (
        <Notice kind="warn">
          아직 로그인 계정이 없는 사람이 {noAccount.length}명 있습니다.
          이름 옆 [계정 만들기]를 눌러 PIN을 정해주세요.
        </Notice>
      )}

      <TeamTabs teams={teams} value={teamId} onChange={setTeamId} />

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
                    const pin = askPin(m.name)
                    if (pin) void run(() => adminLinkMember(m.id, pin), `${m.name} 님의 계정을 만들었습니다.`)
                  }}
                >
                  계정 만들기
                </button>
              ) : (
                <button
                  className="btn ghost small"
                  onClick={() => {
                    const pin = askPin(m.name)
                    if (pin) void run(() => adminResetPin(m.id, pin), `${m.name} 님의 PIN을 ${pin} 로 바꿨습니다.`)
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
          defaultTeamId={teamId}
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
  defaultTeamId, onClose, onSaved,
}: { defaultTeamId: number; onClose: () => void; onSaved: (name: string) => Promise<void> }) {
  const { teams, members } = useApp()
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState(defaultTeamId)
  const [pin, setPin] = useState('0000')
  const [weekendOnly, setWeekendOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 사용자는 절대 입력하지 않는 내부 식별자를 자동으로 만든다 (a01, a02, ...) */
  const suggestCode = (team: number) => {
    const prefix = team === 1 ? 'a' : team === 2 ? 'b' : `t${team}`
    const used = new Set(members.map((m) => m.login_code))
    for (let i = 1; i < 500; i++) {
      const code = `${prefix}${String(i).padStart(2, '0')}`
      if (!used.has(code)) return code
    }
    return `${prefix}${Date.now()}`
  }

  const submit = async () => {
    if (!name.trim()) return setError('이름을 입력해 주세요.')
    if (members.some((m) => m.name === name.trim() && m.active))
      return setError('같은 이름이 이미 명단에 있습니다.')
    if (!/^\d{4}$/.test(pin)) return setError('PIN은 숫자 4자리여야 합니다.')

    setBusy(true); setError(null)
    try {
      await adminCreateMember({
        name: name.trim(),
        login_code: suggestCode(teamId),
        pin,
        team_id: teamId,
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
    <Modal title="해설사 추가" subtitle="이름과 처음 쓸 PIN만 정하면 됩니다." onClose={onClose}>
      {error && <Notice kind="error">{error}</Notice>}

      <div className="field">
        <label htmlFor="new-name">이름</label>
        <input id="new-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <label>조</label>
        <TeamTabs teams={teams} value={teamId} onChange={setTeamId} />
      </div>

      <div className="field">
        <label htmlFor="new-pin">처음 쓸 비밀번호(PIN) 4자리</label>
        <input
          id="new-pin" type="tel" inputMode="numeric" maxLength={4} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          style={{ fontSize: '1.4rem', letterSpacing: '.4em', textAlign: 'center' }}
        />
        <div className="help">본인이 로그인한 뒤 [더보기]에서 직접 바꿀 수 있습니다.</div>
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
