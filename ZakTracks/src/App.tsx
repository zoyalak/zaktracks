import { Fragment, useCallback, useRef, useState } from 'react'
import { useApp } from './state/AppContext'
import { todayKey } from './lib/date'
import { eatenKcalOn, targetsFor } from './lib/selectors'
import { fuelGoalFor } from './lib/fuel'
import AddMealSheet from './components/AddMealSheet'
import Auth from './components/Auth'
import Onboarding from './components/Onboarding'
import Activity from './screens/Activity'
import Chat from './screens/Chat'
import Today from './screens/Today'
import Week from './screens/Week'
import Foods from './screens/Foods'
import Profile, { type ProfileGuard } from './screens/Profile'
import ProfileClassic from './screens/ProfileClassic'
import { CloverLogo, Sheet } from './components/ui'

type Tab = 'activity' | 'today' | 'week' | 'chat' | 'foods' | 'profile'

interface TabDef {
  id: Tab
  label: string
  icon: string
}

/** Mode 2 — the Fuel engine: Activity sits where the chat used to be. */
const FUEL_TABS: TabDef[] = [
  { id: 'today', label: 'Track', icon: '🍽️' },
  { id: 'activity', label: 'Activity', icon: '🏃' },
  { id: 'foods', label: 'Foods', icon: '🛒' },
  { id: 'week', label: 'Logs', icon: '📈' },
]

/** Mode 1 — the app before Fuel, chat coach included. */
const COACH_TABS: TabDef[] = [
  { id: 'today', label: 'Track', icon: '🍽️' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'foods', label: 'Foods', icon: '🛒' },
  { id: 'week', label: 'Logs', icon: '📈' },
]

export default function App() {
  const { ready, profile, user, meals, settings, appMode } = useApp()
  const [tab, setTab] = useState<Tab>('today')
  const [pendingTab, setPendingTab] = useState<Tab | null>(null)
  const [adding, setAdding] = useState(false)
  /** The day the Track screen is showing — also where a new meal lands. */
  const [day, setDay] = useState(todayKey())

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
          <CloverLogo size={52} className="splash-logo" />
          <div className="splash-word">ZakTracks</div>
        </div>
      </div>
    )
  }

  // Accounts keep each person's logs separate on a shared device.
  if (!user) return <Auth />

  if (!profile) return <Onboarding />

  const tabs = appMode === 'coach' ? COACH_TABS : FUEL_TABS
  // The two modes share a tab bar shape, but not its labels: after a switch,
  // a tab the new mode doesn't have (Chat ↔ Activity) falls back to Track.
  // Profile isn't in the bar — the avatar opens it — so it always counts.
  const active: Tab =
    tab === 'profile' || tabs.some((t) => t.id === tab) ? tab : 'today'

  const goTab = (t: Tab) => {
    if (t === active) return
    if (active === 'profile' && guardRef.current?.isDirty()) {
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

  // The Fuel engine's goal (base + movement − deficit) is the target everywhere
  // food is measured against it, in Fuel mode only; Coach mode measures against
  // the profile plan, as it did before Fuel existed.
  const targets = targetsFor(
    profile,
    appMode === 'coach'
      ? null
      : fuelGoalFor(settings.fuel ?? null, settings.fuelDays, todayKey(), (d) => eatenKcalOn(meals, d)),
  )

  return (
    <>
      {/* Chat keeps its own scroll region so the page itself never scrolls. */}
      <div key={appMode} className={active === 'chat' ? 'app chat-mode' : 'app'}>

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
        {active === 'activity' && <Activity />}
        {active === 'today' && <Today date={day} onDate={setDay} />}
        {active === 'chat' && <Chat />}
        {active === 'week' && <Week />}
        {active === 'foods' && <Foods />}
        {active === 'profile' &&
          (appMode === 'coach' ? <ProfileClassic onGuard={onGuard} /> : <Profile onGuard={onGuard} />)}
      </div>
      <nav className="bottomnav">
        <div className="bottomnav-inner" key={appMode}>
          {tabs.map((t, i) => (
            <Fragment key={t.id}>
              {/* Empty middle column that leaves room for the + button. */}
              {i === 2 && <span className="navslot" aria-hidden />}
              <button
                className={`navitem${active === t.id ? ' active' : ''}`}
                onClick={() => goTab(t.id)}
                aria-current={active === t.id}
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
        // From the Track screen the sheet opens on the day you're viewing;
        // elsewhere it starts on today. Saving jumps Track to the day that
        // was logged, so the meal you just added is what you see.
        date={active === 'today' ? day : todayKey()}
        goalKcal={targets.goalKcal}
        onSaved={(meal) => setDay(meal.date)}
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
