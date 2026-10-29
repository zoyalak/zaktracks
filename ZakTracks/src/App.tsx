import { Fragment, useCallback, useRef, useState } from 'react'
import { useApp } from './state/AppContext'
import { todayKey } from './lib/date'
import { targetsFor, totalsFor } from './lib/selectors'
import AddMealSheet from './components/AddMealSheet'
import Onboarding from './components/Onboarding'
import Today from './screens/Today'
import Week from './screens/Week'
import Chat from './screens/Chat'
import Foods from './screens/Foods'
import Profile, { type ProfileGuard } from './screens/Profile'
import { CloverLogo, Sheet } from './components/ui'

type Tab = 'today' | 'week' | 'chat' | 'foods' | 'profile'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Track', icon: '🍽️' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'foods', label: 'Foods', icon: '🛒' },
  { id: 'week', label: 'Logs', icon: '📈' },
]

export default function App() {
  const { ready, profile, meals } = useApp()
  const [tab, setTab] = useState<Tab>('today')
  const [pendingTab, setPendingTab] = useState<Tab | null>(null)
  const [adding, setAdding] = useState(false)

  // The You tab registers a guard here so switching tabs mid-edit can ask
  // "save changes?" instead of silently dropping the draft.
  const guardRef = useRef<ProfileGuard | null>(null)
  const onGuard = useCallback((g: ProfileGuard | null) => {
    guardRef.current = g
  }, [])

  if (!ready) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="center">
          <CloverLogo size={46} className="brand-dot" style={{ margin: '0 auto 14px', display: 'block' }} />
          <div className="muted">Loading ZakTracks…</div>
        </div>
      </div>
    )
  }

  if (!profile) return <Onboarding />

  const goTab = (t: Tab) => {
    if (t === tab) return
    if (tab === 'profile' && guardRef.current?.isDirty()) {
      setPendingTab(t)
      return
    }
    setTab(t)
  }

  const discardAndLeave = () => {
    const target = pendingTab
    guardRef.current?.discard()
    setPendingTab(null)
    if (target) setTab(target)
  }

  const saveAndLeave = () => {
    const target = pendingTab
    if (!target) return
    void Promise.resolve(guardRef.current?.save()).then((ok) => {
      setPendingTab(null)
      // Only leave when the save passed (it can be blocked by validation).
      if (ok) setTab(target)
    })
  }

  const targets = targetsFor(profile)
  const remaining = targets.goalKcal - totalsFor(meals, todayKey()).kcal

  return (
    <>
      <div className="app">

        <div className="brandbar">
          <CloverLogo
            size={30}
            className="brand-dot"
            style={{ width: 30, height: 30, display: 'block' }}
          />
          <button
            className="icon-btn brand-action"
            aria-label="Your profile"
            onClick={() => goTab('profile')}
          >
            👤
          </button>
        </div>
        {tab === 'today' && <Today />}
        {tab === 'week' && <Week />}
        {tab === 'chat' && <Chat />}
        {tab === 'foods' && <Foods />}
        {tab === 'profile' && <Profile onGuard={onGuard} />}
      </div>
      <nav className="bottomnav">
        <div className="bottomnav-inner">
          {TABS.map((t, i) => (
            <Fragment key={t.id}>
              {/* Empty middle column that leaves room for the + button. */}
              {i === 2 && <span className="navslot" aria-hidden />}
              <button
                className={`navitem${tab === t.id ? ' active' : ''}`}
                onClick={() => goTab(t.id)}
                aria-current={tab === t.id}
              >
                <span className="ico" aria-hidden>
                  {t.icon}
                </span>
                {t.label}
              </button>
            </Fragment>
          ))}
        </div>
        <button className="fab" aria-label="Add meal" onClick={() => setAdding(true)}>
          +
        </button>
      </nav>

      <AddMealSheet
        open={adding}
        onClose={() => setAdding(false)}
        date={todayKey()}
        goalKcal={targets.goalKcal}
        remaining={remaining}
      />
      {pendingTab !== null && (
        <Sheet
          open
          onClose={() => setPendingTab(null)}
          title="Unsaved changes"
          sub="You changed your plan but haven't saved it yet. Save your changes before leaving?"
        >
          <div className="btn-row">
            <button className="btn ghost" onClick={discardAndLeave}>
              Discard changes
            </button>
            <button className="btn primary" onClick={saveAndLeave}>
              Save changes
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
