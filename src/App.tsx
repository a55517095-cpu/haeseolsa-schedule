import { useState } from 'react'
import { useApp } from './state/AppContext'
import { Notice, Spinner } from './components/ui'
import ChangePinModal from './components/ChangePinModal'
import Login from './pages/Login'
import MyShifts from './pages/MyShifts'
import FullTable from './pages/FullTable'
import History from './pages/History'
import More from './pages/More'

type Tab = 'my' | 'table' | 'history' | 'more'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'my', icon: '🙋', label: '내 근무' },
  { id: 'table', icon: '📋', label: '전체 근무표' },
  { id: 'history', icon: '🕘', label: '변경 이력' },
  { id: 'more', icon: '⚙️', label: '더보기' },
]

const TITLES: Record<Tab, string> = {
  my: '내 근무',
  table: '전체 근무표',
  history: '변경 이력',
  more: '더보기',
}

export default function App() {
  const { session, me, ready, toast, signOut, needsPinChange, dismissPinPrompt, showToast } = useApp()
  const [tab, setTab] = useState<Tab>('my')

  if (!ready) return <div className="app"><Spinner /></div>
  if (!session) return <div className="app"><Login /></div>

  // 로그인은 됐지만 명단에 연결되지 않은 계정
  if (!me) {
    return (
      <div className="app">
        <div className="page">
          <Notice kind="error">
            이 계정이 해설사 명단에 연결되어 있지 않습니다.
            관리자에게 알려주세요.
          </Notice>
          <button className="btn ghost" onClick={() => void signOut()}>로그아웃</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TITLES[tab]}</h1>
        <span className="who">{me.name} 님</span>
      </header>

      <main className="page">
        {tab === 'my' && <MyShifts />}
        {tab === 'table' && <FullTable />}
        {tab === 'history' && <History />}
        {tab === 'more' && <More />}
      </main>

      <nav className="bottom-nav" aria-label="화면 이동">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className="icon" aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {needsPinChange && (
        <ChangePinModal
          title="비밀번호를 바꿔주세요"
          subtitle="처음 비밀번호(0000)를 그대로 쓰고 계십니다. 나만 아는 숫자 4자리로 정해주세요."
          laterLabel="나중에 변경하기"
          onClose={dismissPinPrompt}
          onDone={() => { dismissPinPrompt(); showToast('비밀번호를 바꿨습니다.') }}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
