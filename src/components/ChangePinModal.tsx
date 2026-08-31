import { useState } from 'react'
import { Modal, Notice } from './ui'
import { changeMyPin, friendlyError } from '../lib/api'

/** 모두의 처음 비밀번호. 관리자가 계정을 만들거나 초기화하면 항상 이 값이 된다. */
export const DEFAULT_PIN = '0000'

export default function ChangePinModal({
  title = '비밀번호(PIN) 바꾸기',
  subtitle = '숫자 4자리로 정해주세요.',
  laterLabel,
  onClose,
  onDone,
}: {
  title?: string
  subtitle?: string
  /** 주면 [바꾸기] 아래에 "나중에" 버튼이 하나 더 생긴다 (첫 로그인 안내용) */
  laterLabel?: string
  onClose: () => void
  onDone: () => void
}) {
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) return setError('숫자 4자리를 입력해 주세요.')
    if (pin !== again) return setError('두 번 입력한 숫자가 서로 다릅니다.')
    if (pin === DEFAULT_PIN) return setError(`${DEFAULT_PIN} 은 처음 비밀번호입니다. 다른 숫자로 정해주세요.`)
    setBusy(true); setError(null)
    try {
      await changeMyPin(pin)
      onDone()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="field">
        <label htmlFor="pin1">새 비밀번호 4자리</label>
        <input
          id="pin1" type="tel" inputMode="numeric" maxLength={4} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          style={{ fontSize: '1.6rem', letterSpacing: '.5em', textAlign: 'center' }}
        />
      </div>
      <div className="field">
        <label htmlFor="pin2">한 번 더 눌러주세요</label>
        <input
          id="pin2" type="tel" inputMode="numeric" maxLength={4} value={again}
          onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))}
          style={{ fontSize: '1.6rem', letterSpacing: '.5em', textAlign: 'center' }}
        />
      </div>

      {laterLabel ? (
        <>
          <button className="btn" style={{ marginTop: 6 }} onClick={submit} disabled={busy}>
            {busy ? '바꾸는 중...' : '바꾸기'}
          </button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={onClose} disabled={busy}>
            {laterLabel}
          </button>
        </>
      ) : (
        <div className="btn-row">
          <button className="btn ghost" onClick={onClose} disabled={busy}>그만두기</button>
          <button className="btn" onClick={submit} disabled={busy}>{busy ? '바꾸는 중...' : '바꾸기'}</button>
        </div>
      )}
    </Modal>
  )
}
