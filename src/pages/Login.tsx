import { useEffect, useState } from 'react'
import { supabase, emailForLoginCode, passwordForPin } from '../lib/supabase'
import { fetchPublicMembers, friendlyError } from '../lib/api'
import type { PublicMember } from '../lib/types'
import { Notice, Spinner } from '../components/ui'

type Step = 'team' | 'name' | 'pin'

export default function Login() {
  const [people, setPeople] = useState<PublicMember[] | null>(null)
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([])
  const [step, setStep] = useState<Step>('team')
  const [teamId, setTeamId] = useState<number | null>(null)
  const [person, setPerson] = useState<PublicMember | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const list = await fetchPublicMembers()
        setPeople(list)
        const { data } = await supabase.from('teams').select('id, name').order('id')
        setTeams(data && data.length > 0
          ? data
          : [...new Set(list.map((p) => p.team_id).filter((t): t is number => t != null))]
              .sort()
              .map((id) => ({ id, name: `${id}조` })))
      } catch (e) {
        setError(friendlyError(e))
        setPeople([])
      }
    })()
  }, [])

  const signIn = async (fullPin: string) => {
    if (!person) return
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: emailForLoginCode(person.login_code),
      password: passwordForPin(fullPin),
    })
    setBusy(false)
    if (signInError) {
      setPin('')
      setError(
        signInError.message.includes('Invalid login credentials')
          ? 'PIN이 맞지 않습니다. 다시 눌러주세요.'
          : friendlyError(signInError),
      )
    }
    // 성공하면 AppProvider 가 알아서 화면을 바꿔준다
  }

  const pressKey = (digit: string) => {
    if (busy || pin.length >= 4) return
    const next = pin + digit
    setPin(next)
    setError(null)
    if (next.length === 4) void signIn(next)
  }

  if (people === null) return <Spinner />

  // ─── 1단계: 조 고르기 ────────────────────────────────────────────────────
  if (step === 'team') {
    return (
      <div className="login-wrap">
        <div className="login-title">
          <div className="app-name">해설사 근무표</div>
          <div className="sub">먼저 본인의 조를 눌러주세요</div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="choice-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {teams.map((t) => (
            <button
              key={t.id}
              className="choice"
              style={{ minHeight: 96, fontSize: '1.4rem' }}
              onClick={() => { setTeamId(t.id); setStep('name') }}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ─── 2단계: 이름 고르기 ─────────────────────────────────────────────────
  if (step === 'name') {
    const list = people
      .filter((p) => p.team_id === teamId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    const others = people.filter((p) => p.team_id == null)

    return (
      <div className="login-wrap">
        <div className="login-title">
          <div className="app-name">본인 이름을 눌러주세요</div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="choice-grid">
          {list.map((p) => (
            <button
              key={p.id}
              className="choice"
              onClick={() => { setPerson(p); setPin(''); setStep('pin') }}
            >
              {p.name}
            </button>
          ))}
        </div>
        {others.length > 0 && (
          <>
            <div className="section-title">그 외</div>
            <div className="choice-grid">
              {others.map((p) => (
                <button
                  key={p.id}
                  className="choice"
                  onClick={() => { setPerson(p); setPin(''); setStep('pin') }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
        <button className="btn ghost" style={{ marginTop: 20 }} onClick={() => setStep('team')}>
          ← 조 다시 고르기
        </button>
      </div>
    )
  }

  // ─── 3단계: PIN 4자리 ───────────────────────────────────────────────────
  return (
    <div className="login-wrap">
      <div className="login-title">
        <div className="app-name">{person?.name} 님</div>
        <div className="sub">비밀번호 4자리를 눌러주세요</div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="pin-dots" aria-label={`${pin.length}자리 입력됨`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? 'filled' : ''} />
        ))}
      </div>

      {busy ? (
        <Spinner />
      ) : (
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => pressKey(d)}>{d}</button>
          ))}
          <button className="wide" onClick={() => { setStep('name'); setPin(''); setError(null) }}>
            뒤로
          </button>
          <button onClick={() => pressKey('0')}>0</button>
          <button className="wide" onClick={() => setPin((p) => p.slice(0, -1))}>지우기</button>
        </div>
      )}

      <div className="help" style={{ textAlign: 'center', marginTop: 22 }}>
        비밀번호를 잊으셨으면 관리자에게 말씀해 주세요.
      </div>
    </div>
  )
}
