import { useApp } from '../state/AppContext'
import type { AppMode } from '../lib/types'
import { Segmented } from './ui'

/** What each mode is, in one line — the same switch sits on both profiles. */
const COPY: Record<AppMode, { tag: string; blurb: string }> = {
  coach: {
    tag: 'Mode 1',
    blurb:
      'The app before Fuel: Track, the chat coach, Foods and Logs. Targets come from your plan.',
  },
  fuel: {
    tag: 'Mode 2',
    blurb:
      'The Fuel engine: base burn × 1.2 + steps and workouts − your deficit, with half of yesterday’s leftovers carried forward.',
  },
}

/**
 * Switch between the two versions of the app. Your meals, foods and weight log
 * are the same in both — only the screens and the target maths change.
 */
export default function ModeSwitch() {
  const { appMode, setAppMode } = useApp()
  const copy = COPY[appMode]

  return (
    <div className="card mode-card">
      <div className="card-title">
        <h2>App mode</h2>
        <span className="hint">{copy.tag}</span>
      </div>
      <Segmented
        options={[
          { value: 'coach', label: '1 · Coach' },
          { value: 'fuel', label: '2 · Fuel' },
        ]}
        value={appMode}
        onChange={(v) => void setAppMode(v as AppMode)}
      />
      <p className="tiny muted" style={{ margin: '10px 0 0' }}>
        {copy.blurb}
      </p>
    </div>
  )
}
