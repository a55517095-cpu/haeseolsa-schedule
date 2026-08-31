import { useEffect, useState } from 'react'
import { supabase, emailForLoginCode, passwordForPin } from '../lib/supabase'
import { fetchPublicMembers, friendlyError } from '../lib/api'
import type { PublicMember } from '../lib/types'
import { Notice, Spinner } from '../components/ui'
import { useApp } from '../state/AppContext'

/** 관리자 계정인가 (로그인 화면에는 role 이 내려오지 않아 login_code 로 가른다) */
const isAdmin = (p: PublicMember) => p.login_code === 'admin' || p.name === '관리자'

export default function Login() {
  const { noteLoginPin } = useApp()
  const [people, setPeople] = useState<PublicMember[] | null>(null)
  const [person, setPerson] = useState<PublicMember | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        setPeople(await fetchPublicMembers())
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
    if (!signInError) {
      // 처음 비밀번호 그대로면 로그인 직후 바꾸기 안내를 띄운다
      noteLoginPin(fullPin)
    }
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

  // ─── 1단계: 이름 고르기 ─────────────────────────────────────────────────
  if (!person) {
    // 해설사는 가나다순, 관리자는 항상 맨 끝
    const list = [...people].sort((a, b) => {
      if (isAdmin(a) !== isAdmin(b)) return isAdmin(a) ? 1 : -1
      return a.name.localeCompare(b.name, 'ko')
    })

    return (
      <div className="login-wrap">
        <div className="login-title">
          <div className="app-name">해설사 근무표</div>
          <div className="sub">본인 이름을 눌러주세요</div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="choice-grid name-grid">
          {list.map((p) => (
            <button
              key={p.id}
              className={isAdmin(p) ? 'choice admin' : 'choice'}
              onClick={() => { setPerson(p); setPin(''); setError(null) }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ─── 2단계: PIN 4자리 ───────────────────────────────────────────────────
  return (
    <div className="login-wrap">
      <div className="login-title">
        <div className="app-name">{person.name} 님</div>
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
          <button
            className="wide"
            onClick={() => { setPerson(null); setPin(''); setError(null) }}
          >
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
