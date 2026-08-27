import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { Modal, Notice } from '../components/ui'
import { changeMyPin, friendlyError } from '../lib/api'
import AdminImport from './AdminImport'
import AdminMembers from './AdminMembers'

type Sub = null | 'import' | 'members'

export default function More() {
  const { me, teams, fontScale, setFontScale, signOut, showToast } = useApp()
  const [sub, setSub] = useState<Sub>(null)
  const [pinOpen, setPinOpen] = useState(false)

  if (sub === 'import') return <AdminImport onBack={() => setSub(null)} />
  if (sub === 'members') return <AdminMembers onBack={() => setSub(null)} />

  const teamName = teams.find((t) => t.id === me?.team_id)?.name ?? '-'
  const installed = window.matchMedia('(display-mode: standalone)').matches

  return (
    <>
      <div className="card">
        <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{me?.name} 님</div>
        <div className="help">
          {teamName}
          {me?.role === 'admin' && ' · 관리자'}
        </div>
      </div>

      <div className="section-title">글자 크기</div>
      <div className="card">
        <div className="btn-row">
          {[
            { label: '보통', value: 1 },
            { label: '크게', value: 1.2 },
            { label: '아주 크게', value: 1.45 },
          ].map((opt) => (
            <button
              key={opt.value}
              className={`btn ${fontScale === opt.value ? '' : 'ghost'}`}
              onClick={() => setFontScale(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="help" style={{ marginTop: 10 }}>
          글자가 작아 보이시면 [크게]를 눌러보세요. 앱 전체 글씨가 커집니다.
        </div>
      </div>

      <div className="section-title">내 계정</div>
      <button className="btn ghost" onClick={() => setPinOpen(true)}>비밀번호(PIN) 바꾸기</button>

      {me?.role === 'admin' && (
        <>
          <div className="section-title">관리자</div>
          <button className="btn" style={{ marginBottom: 10 }} onClick={() => setSub('import')}>
            근무표 등록하기
          </button>
          <button className="btn secondary" onClick={() => setSub('members')}>
            해설사 명단 관리
          </button>
        </>
      )}

      {!installed && (
        <>
          <div className="section-title">휴대폰 홈 화면에 두기</div>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 8 }}>아이폰</div>
            <div className="help" style={{ marginBottom: 14 }}>
              사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>
            </div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>안드로이드</div>
            <div className="help">
              크롬 오른쪽 위 <b>점 세 개(⋮)</b> → <b>홈 화면에 추가</b>
            </div>
            <div className="help" style={{ marginTop: 14 }}>
              한 번 추가해두면 다음부터는 아이콘만 누르면 됩니다.
            </div>
          </div>
        </>
      )}

      <div className="section-title">&nbsp;</div>
      <button
        className="btn danger-outline"
        onClick={() => {
          if (confirm('로그아웃하시겠습니까? 다시 들어오려면 이름과 PIN을 눌러야 합니다.')) void signOut()
        }}
      >
        로그아웃
      </button>

      {pinOpen && (
        <ChangePinModal
          onClose={() => setPinOpen(false)}
          onDone={() => { setPinOpen(false); showToast('비밀번호를 바꿨습니다.') }}
        />
      )}
    </>
  )
}

function ChangePinModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) return setError('숫자 4자리를 입력해 주세요.')
    if (pin !== again) return setError('두 번 입력한 숫자가 서로 다릅니다.')
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
    <Modal title="비밀번호(PIN) 바꾸기" subtitle="숫자 4자리로 정해주세요." onClose={onClose}>
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
      <div className="btn-row">
        <button className="btn ghost" onClick={onClose} disabled={busy}>그만두기</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? '바꾸는 중...' : '바꾸기'}</button>
      </div>
    </Modal>
  )
}
