import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { todayKey } from '../lib/date'
import { eatenKcalOn } from '../lib/selectors'
import { fuelBreakdown } from '../lib/fuel'
import {
  FuelActivityCard,
  FuelReceiptCard,
  FuelSetupCard,
  FuelSetupSheet,
} from '../components/FuelPanel'

/**
 * Where the day's target comes from: the itemised goal, the setup behind it,
 * and the movement that tops it up.
 */
export default function Activity() {
  const { profile, meals, settings, saveFuel } = useApp()
  const [setupOpen, setSetupOpen] = useState(false)

  if (!profile) return null

  const date = todayKey()
  const plan = settings.fuel ?? null
  const day = settings.fuelDays?.find((d) => d.date === date) ?? null
  const fuel = fuelBreakdown(plan, settings.fuelDays, date, (d) => eatenKcalOn(meals, d))

  return (
    <>
      <div className="topbar">
        <div>
          <div className="sub">Where the goal comes from</div>
          <h1>Activity</h1>
        </div>
        {plan && (
          <button className="btn small" onClick={() => setSetupOpen(true)}>
            Setup
          </button>
        )}
      </div>

      {!plan || !fuel ? (
        <FuelSetupCard onSave={saveFuel} />
      ) : (
        <>
          <FuelActivityCard plan={plan} date={date} day={day} title="Activity" />
          <FuelReceiptCard receipt={fuel.receipt} carry={fuel.carry} />
          <FuelSetupSheet
            open={setupOpen}
            onClose={() => setSetupOpen(false)}
            plan={plan}
            onSave={saveFuel}
          />
        </>
      )}
    </>
  )
}
