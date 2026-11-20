import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { keyToDate } from '../lib/date'
import { ApiError, estimateWorkout } from '../lib/api'
import {
  CARRY_SHARE,
  FUEL_BASE_FACTOR,
  MAX_DEFICIT_KCAL,
  MAX_DEFICIT_SHARE,
  OVER_SHARE,
  OVER_THRESHOLD_KCAL,
  fuelBaseKcal,
  fuelDeficitLimit,
  fuelStepsKcal,
  type FuelCarry,
  type FuelReceipt,
} from '../lib/fuel'
import type { FuelDay, FuelPlan, FuelWorkout, Macro, Sex, UnitSystem } from '../lib/types'
import { cmToFtIn, displayWeight, ftInToCm, toKg, weightLabel } from '../lib/units'
import { Field, FieldError, Notice, NumberField, Segmented, Sheet } from './ui'

const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const num = (v: string): number => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

const fromLabel = (key: string): string =>
  keyToDate(key).toLocaleDateString(undefined, { weekday: 'long' })

/* --------------------------------------------------------------- receipt */

/**
 * The itemised target: base burn, the movement that was logged, the deficit,
 * anything carried over from yesterday, and the goal they add up to.
 */
export function FuelReceiptCard({
  receipt,
  carry,
}: {
  receipt: FuelReceipt
  carry: FuelCarry
}) {
  return (
    <div className="card">
      <div className="card-title">
        <h2>Today's goal</h2>
        <span className="hint">the receipt</span>
      </div>

      <div className="receipt">
        <div className="receipt-row">
          <span className="rk">
            <b>Base</b>
            <span className="tiny muted">BMR × {FUEL_BASE_FACTOR}</span>
          </span>
          <span className="rv num">{receipt.baseKcal.toLocaleString()}</span>
        </div>

        <div className="receipt-row">
          <span className="rk">
            <b>Steps</b>
            <span className="tiny muted">
              {receipt.steps > 0 ? `${receipt.steps.toLocaleString()} walked` : 'none logged'}
            </span>
          </span>
          <span className={receipt.stepsKcal > 0 ? 'rv num pos' : 'rv num muted'}>
            +{receipt.stepsKcal.toLocaleString()}
          </span>
        </div>

        {receipt.workouts.map((w) => (
          <div className="receipt-row" key={w.id}>
            <span className="rk">
              <b>{w.label}</b>
              <span className="tiny muted">
                {w.source === 'manual' ? 'your own estimate' : 'AI estimate'}
              </span>
            </span>
            <span className="rv num pos">+{Math.round(w.kcal).toLocaleString()}</span>
          </div>
        ))}

        {carry.kcal > 0 && (
          <div className="receipt-row">
            <span className="rk">
              <b>Left over</b>
              <span className="tiny muted">
                {Math.round(CARRY_SHARE * 100)}% of {fromLabel(carry.from)}'s{' '}
                {carry.shortfallKcal.toLocaleString()} uneaten
              </span>
            </span>
            <span className="rv num pos">+{carry.kcal.toLocaleString()}</span>
          </div>
        )}

        {carry.kcal < 0 && (
          <div className="receipt-row">
            <span className="rk">
              <b>Over</b>
              <span className="tiny muted">
                {Math.round(OVER_SHARE * 100)}% of {fromLabel(carry.from)}'s{' '}
                {carry.overKcal.toLocaleString()} over goal
              </span>
            </span>
            <span className="rv num neg">{carry.kcal.toLocaleString()}</span>
          </div>
        )}

        <div className="receipt-row">
          <span className="rk">
            <b>Deficit</b>
            <span className="tiny muted">
              {receipt.deficitClamped
                ? `capped at ${receipt.deficitLimit.toLocaleString()} from your ${receipt.requestedDeficit.toLocaleString()} setting`
                : 'your daily setting'}
            </span>
          </span>
          <span className="rv num neg">−{receipt.deficitKcal.toLocaleString()}</span>
        </div>

        <div className="receipt-total">
          <span className="rk">
            <b>Goal</b>
            <span className="tiny muted">
              {carry.kcal > 0
                ? 'base + movement + leftover − deficit'
                : carry.kcal < 0
                  ? 'base + movement − over − deficit'
                  : 'base + movement − deficit'}
            </span>
          </span>
          <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>
            {receipt.goalKcal.toLocaleString()}{' '}
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>kcal</span>
          </span>
        </div>
      </div>

      {receipt.floorApplied && (
        <div style={{ marginTop: 12 }}>
          <Notice type="warn">
            The goal can't go below <b>{receipt.floorKcal.toLocaleString()} kcal</b>, so today's
            deficit is smaller than your setting.
          </Notice>
        </div>
      )}
      {receipt.deficitClamped && !receipt.floorApplied && (
        <div style={{ marginTop: 12 }}>
          <Notice type="info">
            Deficits are capped at <b>{receipt.deficitLimit.toLocaleString()} kcal</b> a day (up to{' '}
            {Math.round(MAX_DEFICIT_SHARE * 100)}% of your base burn and {MAX_DEFICIT_KCAL} kcal
            overall).
          </Notice>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- activity */

/** Yesterday's movement, which tops up the goal of the day being viewed. */
export function FuelActivityCard({
  plan,
  date,
  day,
  title = 'Activity',
}: {
  plan: FuelPlan
  date: string
  day: FuelDay | null
  title?: string
}) {
  const { saveFuelDay } = useApp()

  const commit = (patch: Partial<FuelDay>) =>
    saveFuelDay({
      date,
      steps: day?.steps ?? 0,
      workouts: day?.workouts ?? [],
      ...patch,
    })

  return (
    <div className="card">
      <div className="card-title">
        <h2>{title}</h2>
        <span className="hint">adds to this day's goal</span>
      </div>
      <StepsField plan={plan} day={day} commit={commit} />
      <WorkoutsField plan={plan} day={day} commit={commit} />
    </div>
  )
}

function StepsField({
  plan,
  day,
  commit,
}: {
  plan: FuelPlan
  day: FuelDay | null
  commit: (patch: Partial<FuelDay>) => void
}) {
  const [text, setText] = useState(day?.steps ? String(day.steps) : '')

  // Re-sync when the saved value changes (first load, or a workout save).
  useEffect(() => {
    setText(day?.steps ? String(day.steps) : '')
  }, [day?.steps])

  // Debounced so a long number is saved once, not on every digit.
  useEffect(() => {
    const next = Math.max(0, Math.round(num(text)))
    if (next === (day?.steps ?? 0)) return
    const t = setTimeout(() => commit({ steps: next }), 600)
    return () => clearTimeout(t)
  }, [text, day?.steps, commit])

  // Show what the steps are worth straight away, off the typed number rather
  // than the saved one, so the figure moves as the user types.
  const stepsKcal = fuelStepsKcal(plan, Math.max(0, Math.round(num(text))))

  return (
    <NumberField
      label="Steps"
      aside={
        <span className={stepsKcal > 0 ? 'tiny num pos' : 'tiny num'}>
          {stepsKcal > 0 ? `+${stepsKcal.toLocaleString()} kcal` : '0 kcal'}
        </span>
      }
      unit="steps"
      value={text}
      onChange={setText}
      step={100}
      min={0}
      placeholder="e.g. 8500"
    />
  )
}

function WorkoutsField({
  plan,
  day,
  commit,
}: {
  plan: FuelPlan
  day: FuelDay | null
  commit: (patch: Partial<FuelDay>) => void
}) {
  const [desc, setDesc] = useState('')
  const [kcalText, setKcalText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workouts = day?.workouts ?? []
  const canAdd = desc.trim().length > 0 && num(kcalText) > 0

  const estimate = async () => {
    const text = desc.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await estimateWorkout(text, plan.weightKg)
      setKcalText(String(res.kcal))
      setNote(res.note || null)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not estimate that — type the kcal instead.',
      )
    } finally {
      setBusy(false)
    }
  }

  const add = () => {
    if (!canAdd) return
    const workout: FuelWorkout = {
      id: newId(),
      label: desc.trim(),
      kcal: Math.round(num(kcalText)),
      source: note ? 'ai' : 'manual',
    }
    commit({ workouts: [...workouts, workout] })
    setDesc('')
    setKcalText('')
    setNote(null)
    setError(null)
  }

  return (
    <>
      <Field label="Workout" hint="Describe it, then estimate or type the calories yourself.">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="e.g. 45 min run"
            enterKeyHint="done"
          />
          <button
            className="btn small"
            style={{ flex: '0 0 auto' }}
            disabled={!desc.trim() || busy}
            onClick={() => void estimate()}
          >
            {busy ? '…' : 'Estimate'}
          </button>
        </div>
      </Field>
      <NumberField
        label="Calories"
        unit="kcal"
        value={kcalText}
        onChange={setKcalText}
        step={5}
        min={0}
      />
      {note && (
        <div className="tiny muted" style={{ marginTop: -4, marginBottom: 8 }}>
          {note}
        </div>
      )}
      {error && <Notice type="error">{error}</Notice>}
      <button className="btn primary" disabled={!canAdd} onClick={add}>
        Add workout
      </button>

      {workouts.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {workouts.map((w) => (
            <div key={w.id} className="kv">
              <span className="k">
                {w.label}
                <span className="tiny muted"> · {Math.round(w.kcal)} kcal</span>
              </span>
              <button
                className="icon-btn"
                aria-label={`Remove ${w.label}`}
                onClick={() => commit({ workouts: workouts.filter((x) => x.id !== w.id) })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/* ----------------------------------------------------------------- setup */

/** First-run setup: the body, plus the deficit — nothing about cutting. */
export function FuelSetupCard({ onSave }: { onSave: (plan: FuelPlan) => void | Promise<void> }) {
  const { profile } = useApp()
  if (!profile) return null
  return (
    <div className="card">
      <div className="card-title">
        <h2>Set up your goal</h2>
        <span className="hint">asked once</span>
      </div>
      <p className="tiny muted" style={{ marginTop: 0 }}>
        Your body stats give the base burn, and your deficit is what you eat below it. Every step
        and workout you log is added on top, and half of whatever you leave uneaten rolls into the
        next day. Go {OVER_THRESHOLD_KCAL}+ kcal over and half of the overage comes off the next
        day's goal instead.
      </p>
      <FuelSetupForm units={profile.units} initial={null} onSave={onSave} />
    </div>
  )
}

export function FuelSetupSheet({
  open,
  onClose,
  plan,
  onSave,
}: {
  open: boolean
  onClose: () => void
  plan: FuelPlan
  onSave: (plan: FuelPlan) => Promise<void>
}) {
  const { profile } = useApp()
  if (!profile) return null
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Goal setup"
      sub="Your base burn and deficit — changing these changes today's goal."
    >
      <FuelSetupForm
        units={profile.units}
        initial={plan}
        onSave={async (next) => {
          await onSave(next)
          onClose()
        }}
      />
    </Sheet>
  )
}

export function FuelSetupForm({
  units,
  initial,
  onSave,
}: {
  units: UnitSystem
  initial: FuelPlan | null
  onSave: (plan: FuelPlan) => void | Promise<void>
}) {
  const { profile } = useApp()
  const profilePlan: FuelPlan = {
    sex: profile?.sex ?? 'undisclosed',
    age: profile?.age ?? 30,
    heightCm: profile?.heightCm ?? 175,
    weightKg: profile?.weightKg ?? 70,
    deficitKcal: 300,
  }
  const seed = initial ?? profilePlan

  const [sex, setSex] = useState<Sex>(seed.sex)
  const [age, setAge] = useState(String(seed.age))
  const [heightCm, setHeightCm] = useState(String(Math.round(seed.heightCm)))
  const ftin = cmToFtIn(seed.heightCm)
  const [ft, setFt] = useState(String(ftin.ft))
  const [inch, setInch] = useState(String(ftin.in))
  const [weight, setWeight] = useState(String(displayWeight(seed.weightKg, units)))
  const [deficit, setDeficit] = useState(String(seed.deficitKcal))
  const [saving, setSaving] = useState(false)

  const heightValue = units === 'metric' ? num(heightCm) : ftInToCm(num(ft), num(inch))
  const weightKg = toKg(num(weight), units)

  const draft: FuelPlan = {
    sex,
    age: num(age),
    heightCm: heightValue,
    weightKg,
    deficitKcal: Math.max(0, Math.round(num(deficit))),
  }

  const base = weightKg > 0 && heightValue > 0 && draft.age > 0 ? fuelBaseKcal(draft) : 0
  const limit = base > 0 ? fuelDeficitLimit(draft) : 0

  const ageError =
    age.trim() && (draft.age < 13 || draft.age > 110) ? 'Enter an age between 13 and 110.' : undefined
  const heightError =
    heightValue > 0 && (heightValue < 120 || heightValue > 230)
      ? 'Enter a height between 120 and 230 cm.'
      : undefined
  const weightError =
    weightKg > 0 && (weightKg < 30 || weightKg > 350)
      ? 'Enter a weight between 30 and 350 kg.'
      : undefined
  const deficitError =
    draft.deficitKcal > 0 && draft.deficitKcal > limit
      ? `Keep it under ${limit.toLocaleString()} kcal a day.`
      : undefined

  const valid =
    draft.age >= 13 &&
    draft.age <= 110 &&
    heightValue >= 120 &&
    heightValue <= 230 &&
    weightKg >= 30 &&
    weightKg <= 350 &&
    draft.deficitKcal >= 0 &&
    draft.deficitKcal <= limit &&
    base > 0

  return (
    <>
      <Field label="Gender">
        <Segmented
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
            { value: 'undisclosed', label: 'Skip' },
          ]}
          value={sex}
          onChange={(v) => setSex(v as Sex)}
        />
      </Field>

      <div className="field-row">
        <NumberField label="Age" value={age} onChange={setAge} unit="years" step={1} />
        <NumberField
          label={`Weight (${weightLabel(units)})`}
          value={weight}
          onChange={setWeight}
          unit={weightLabel(units)}
          step={0.1}
        />
      </div>
      <FieldError msg={ageError || weightError} />

      {units === 'metric' ? (
        <NumberField label="Height (cm)" value={heightCm} onChange={setHeightCm} unit="cm" step={1} />
      ) : (
        <div className="field-row">
          <NumberField label="Height" value={ft} onChange={setFt} unit="ft" step={1} />
          <NumberField label="" value={inch} onChange={setInch} unit="in" step={1} />
        </div>
      )}
      <FieldError msg={heightError} />

      <NumberField
        label="Daily deficit"
        value={deficit}
        onChange={setDeficit}
        unit="kcal"
        step={50}
        min={0}
        max={Math.max(0, limit)}
      />
      <div className="tiny muted" style={{ marginTop: -4 }}>
        {base > 0
          ? `Eat this much below your ${base.toLocaleString()} kcal base burn. Up to ${limit.toLocaleString()} kcal a day.`
          : `Eat below your base burn. Up to ${MAX_DEFICIT_KCAL} kcal a day.`}
      </div>
      <FieldError msg={deficitError} />

      <button
        className="btn primary"
        disabled={!valid || saving}
        onClick={() => {
          setSaving(true)
          void Promise.resolve(onSave(draft)).finally(() => setSaving(false))
        }}
      >
        {initial ? 'Save setup' : 'Start tracking'}
      </button>
    </>
  )
}

/** Small macro line: the goal's protein / carbs / fat. */
export function FuelMacroLine({ macro }: { macro: Macro }) {
  return (
    <div className="num" style={{ fontSize: 15, marginTop: 4 }}>
      <span style={{ color: 'var(--protein)' }}>{macro.protein}g P</span>
      {' · '}
      <span style={{ color: 'var(--carbs)' }}>{macro.carbs}g C</span>
      {' · '}
      <span style={{ color: 'var(--fat)' }}>{macro.fat}g F</span>
    </div>
  )
}
