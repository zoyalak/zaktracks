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
      </div>

      {!plan || !fuel ? (
        <FuelSetupCard onSave={saveFuel} />
      ) : (
        <>
          <FuelReceiptCard
            receipt={fuel.receipt}
            carry={fuel.carry}
            onEdit={() => setSetupOpen(true)}
          />
          <FuelActivityCard plan={plan} date={date} day={day} />
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
