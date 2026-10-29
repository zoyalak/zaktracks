import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { getAiTargets } from '../lib/api'
import type { ActivityKey, GoalType, Profile, Sex, UnitSystem } from '../lib/types'
import { ACTIVITY, defaultSplit, goalPlan, macroTargets } from '../lib/nutrition'
import { cmToFtIn, displayWeight, ftInToCm, fromKg, toKg, weightLabel } from '../lib/units'
import { Choice, CloverLogo, Field, FieldError, NumberField, Segmented } from './ui'

const STEPS = ['You', 'Body', 'Activity', 'Goal', 'Plan'] as const

const GOALS: { id: GoalType; emoji: string; title: string; desc: string }[] = [
  { id: 'maintain', emoji: '⚖️', title: 'Maintain', desc: 'Hold your weight where it is' },
  { id: 'cut', emoji: '🔥', title: 'Cut', desc: 'Lose fat on a schedule' },
  { id: 'bulk', emoji: '💪', title: 'Gain', desc: 'Gain weight on a schedule' },
]

export default function Onboarding() {
  const { saveProfile } = useApp()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  const [units, setUnits] = useState<UnitSystem>('metric')
  const [sex, setSex] = useState<Sex>('undisclosed')
  const [age, setAge] = useState('28')
  const [heightCm, setHeightCm] = useState('175')
  const [weightInput, setWeightInput] = useState('78')
  const [activity, setActivity] = useState<ActivityKey>('moderate')
  const [goal, setGoal] = useState<GoalType>('maintain')
  const [targetInput, setTargetInput] = useState('78')
  const [weeks, setWeeks] = useState('12')
  const [proteinPerKg, setProteinPerKg] = useState('1.8')
  // Raw text for the imperial height boxes: clearing one shows an empty box
  // (never a snapped-back 0) and blocks Continue with a reminder.
  const [ftRaw, setFtRaw] = useState<string | null>(null)
  const [inRaw, setInRaw] = useState<string | null>(null)

  const weightNum = parseFloat(weightInput)
  const heightNum = parseFloat(heightCm)
  const ageNum = parseFloat(age)
  const weightKg = Number.isFinite(weightNum) ? toKg(weightNum, units) : 0
  const heightIncomplete = units === 'imperial' && (ftRaw === '' || inRaw === '')

  const switchUnits = (next: UnitSystem) => {
    if (next === units) return
    setFtRaw(null)
    setInRaw(null)
    if (Number.isFinite(weightNum)) setWeightInput(String(Math.round(fromKg(weightKg, next) * 10) / 10))
    const t = parseFloat(targetInput)
    if (Number.isFinite(t)) {
      const kg = toKg(t, units)
      setTargetInput(String(Math.round(fromKg(kg, next) * 10) / 10))
    }
    setUnits(next)
  }

  const targetKg = useMemo(() => {
    const parsed = parseFloat(targetInput)
    if (!Number.isFinite(parsed)) return weightKg
    return goal === 'maintain' ? weightKg : toKg(parsed, units)
  }, [targetInput, weightKg, units, goal])

  // Pace bounds for the weeks slider — deliberately wide: quick cuts and
  // faster bulks down at one end, very gradual changes up at the other. The
  // plan itself still shows its "faster than ~1% of body weight" warning, so a
  // fast pick is allowed but never silent.
  const deltaKg = Math.abs(targetKg - weightKg)
  const fastRateKg = goal === 'cut' ? Math.max(0.6, weightKg * 0.015) : Math.max(0.35, weightKg * 0.01)
  const slowRateKg = Math.max(0.08, weightKg * 0.0015)
  const minWeeks = Math.max(1, Math.ceil(deltaKg / fastRateKg))
  const maxWeeks = Math.max(104, Math.ceil(deltaKg / slowRateKg))
  // The raw slider string is kept as-is; only the value we show and save is
  // clamped, so an out-of-range choice comes back if it becomes valid again.
  const weeksNum = Math.min(maxWeeks, Math.max(minWeeks, Math.round(parseFloat(weeks) || 12)))

  const draft: Profile = {
    sex,
    age: Number.isFinite(ageNum) ? ageNum : 30,
    heightCm: Number.isFinite(heightNum) ? heightNum : 175,
    weightKg,
    activity,
    goal,
    targetWeightKg: targetKg,
    weeks: weeksNum,
    proteinPerKg: parseFloat(proteinPerKg) || 1.8,
    // Fat is picked automatically from the goal — no dial for beginners.
    fatPct: defaultSplit(goal).fatPct,
    units,
  }

  const plan = useMemo(() => goalPlan(draft), [draft])
  const macros = useMemo(() => macroTargets(draft, plan.target), [draft, plan.target])
  const valid = {
    0: Number.isFinite(ageNum) && ageNum >= 13,
    1:
      Number.isFinite(weightNum) &&
      weightNum > 0 &&
      Number.isFinite(heightNum) &&
      heightNum > 0 &&
      !heightIncomplete,
    2: true,
    3: goal === 'maintain' || (Number.isFinite(parseFloat(targetInput)) && parseFloat(targetInput) > 0),
    4: Number.isFinite(parseFloat(proteinPerKg)) && parseFloat(proteinPerKg) > 0,
  } as const

  const pickGoal = (g: GoalType) => {
    setGoal(g)
    if (g === 'maintain') {
      setTargetInput(String(Math.round(fromKg(weightKg, units) * 10) / 10))
    } else if (g === 'cut') {
      setTargetInput(String(Math.round(fromKg(Math.max(35, weightKg - 5), units) * 10) / 10))
    } else {
      setTargetInput(String(Math.round(fromKg(weightKg + 5, units) * 10) / 10))
    }
    setProteinPerKg(String(defaultSplit(g).proteinPerKg))
  }

  const finish = async () => {
    setSaving(true)
    try {
      await saveProfile(draft)
      // Ask the AI for a split tailored to this profile in the background;
      // the standard formula split stands until it lands (or forever, offline).
      void getAiTargets(draft, plan.target)
        .then((ai) => saveProfile({ ...draft, aiTargets: { ...ai, at: Date.now() } }))
        .catch(() => undefined)
    } finally {
      setSaving(false)
    }
  }

  const ftin = cmToFtIn(Number.isFinite(heightNum) ? heightNum : 175)

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <CloverLogo size={26} className="brand-dot" />
          <div>
            <h1>ZakTracks</h1>
            <div className="sub">Calories & macros, from a photo</div>
          </div>
        </div>
      </div>

      <div className="step-dots">
        {STEPS.map((s, i) => (
          <i key={s} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <div className="card">
          <div className="card-title">
            <h2>Let's set up your plan</h2>
            <span className="hint">Step 1 of 5</span>
          </div>
          <Field label="Units">
            <Segmented
              options={[
                { value: 'metric', label: 'kg · cm' },
                { value: 'imperial', label: 'lb · ft' },
              ]}
              value={units}
              onChange={switchUnits}
            />
          </Field>
          <Field label="Sex (used for the metabolic formula)">
            <Segmented
              options={[
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'undisclosed', label: 'Prefer not to say' },
              ]}
              value={sex}
              onChange={(v) => setSex(v as Sex)}
            />
          </Field>
          <NumberField label="Age" value={age} onChange={setAge} unit="years" min={13} />
          {age.trim() === '' ? (
            <FieldError msg="Please enter your age." />
          ) : !valid[0] ? (
            <FieldError msg="Age must be 13+." />
          ) : null}
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <div className="card-title">
            <h2>Where are you now?</h2>
            <span className="hint">Step 2 of 5</span>
          </div>
          <NumberField
            label={`Weight (${weightLabel(units)})`}
            value={weightInput}
            onChange={setWeightInput}
            unit={weightLabel(units)}
            step={0.5}
          />
          {weightInput.trim() === '' || !(Number.isFinite(weightNum) && weightNum > 0) ? (
            <FieldError msg="Please enter your weight." />
          ) : null}
          {units === 'metric' ? (
            <>
              <NumberField
                label="Height (cm)"
                value={heightCm}
                onChange={setHeightCm}
                unit="cm"
                step={0.5}
              />
              {heightCm.trim() === '' || !(Number.isFinite(heightNum) && heightNum > 0) ? (
                <FieldError msg="Please enter your height." />
              ) : null}
            </>
          ) : (
            <>
              <div className="field-row">
                <NumberField
                  label="Height (ft)"
                  value={ftRaw ?? String(ftin.ft)}
                  onChange={(v) => {
                    setFtRaw(v)
                    if (v.trim() === '') return
                    const n = parseFloat(v)
                    if (!Number.isFinite(n)) return
                    const inch = parseFloat(inRaw ?? String(ftin.in))
                    setHeightCm(String(ftInToCm(n, Number.isFinite(inch) ? inch : 0)))
                  }}
                  unit="ft"
                  min={1}
                  max={8}
                />
                <NumberField
                  label="Height (in)"
                  value={inRaw ?? String(ftin.in)}
                  onChange={(v) => {
                    setInRaw(v)
                    if (v.trim() === '') return
                    const n = parseFloat(v)
                    if (!Number.isFinite(n)) return
                    const ft = parseFloat(ftRaw ?? String(ftin.ft))
                    setHeightCm(String(ftInToCm(Number.isFinite(ft) ? ft : 0, n)))
                  }}
                  unit="in"
                  min={0}
                  max={11}
                />
              </div>
              {heightIncomplete && <FieldError msg="Please enter your height." />}
            </>
          )}
          <div className="notice info">
            Your resting burn is estimated with the Mifflin-St Jeor formula — the same one most
            coaches and dietitians use.
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <div className="card-title">
            <h2>How active are you?</h2>
            <span className="hint">Step 3 of 5</span>
          </div>
          {(Object.keys(ACTIVITY) as ActivityKey[]).map((key) => (
            <Choice
              key={key}
              emoji={
                key === 'sedentary' ? '🪑' : key === 'light' ? '🚶' : key === 'moderate' ? '🏃' : key === 'active' ? '🏋️' : '🏅'
              }
              title={`${ACTIVITY[key].label} · ×${ACTIVITY[key].factor}`}
              desc={ACTIVITY[key].hint}
              active={activity === key}
              onClick={() => setActivity(key)}
            />
          ))}
          {weightKg > 0 && (
            <div className="total-strip mt">
              <span className="muted">Maintenance (hold your weight)</span>
              <b className="num">{plan.maintenance.toLocaleString()} kcal</b>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <div className="card-title">
            <h2>What's the goal?</h2>
            <span className="hint">Step 4 of 5</span>
          </div>
          {GOALS.map((g) => (
            <Choice
              key={g.id}
              emoji={g.emoji}
              title={g.title}
              desc={g.desc}
              active={goal === g.id}
              onClick={() => pickGoal(g.id)}
            />
          ))}

          {goal !== 'maintain' && (
            <>
              <div className="divider" />
              <NumberField
                label={`Target weight (${weightLabel(units)})`}
                value={targetInput}
                onChange={setTargetInput}
                unit={weightLabel(units)}
                step={0.5}
              />
              {!valid[3] && <FieldError msg="Please enter your target weight." />}
              <Field
                label={`In ${weeksNum} week${weeksNum === 1 ? '' : 's'}`}
                hint={`${displayWeight(weightKg, units)} ${weightLabel(units)} → ${displayWeight(targetKg, units)} ${weightLabel(units)} · ${minWeeks}–${maxWeeks} wks available`}
              >
                <input
                  className="input"
                  type="range"
                  min={minWeeks}
                  max={maxWeeks}
                  step={1}
                  value={weeksNum}
                  onChange={(e) => setWeeks(e.target.value)}
                  style={{ padding: '10px 0', background: 'transparent', border: 'none' }}
                />
              </Field>
            </>
          )}

          {valid[3] && (
            <div className="total-strip">
              <span className="muted">Daily target</span>
              <b className="num" style={{ color: 'var(--accent)' }}>
                {plan.target.toLocaleString()} kcal
              </b>
            </div>
          )}
          {plan.clamped && plan.warning && <div className="notice">{plan.warning}</div>}
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <div className="card-title">
            <h2>Your macro split</h2>
            <span className="hint">Step 5 of 5</span>
          </div>
          <NumberField
            label="Protein per kg of goal weight"
            value={proteinPerKg}
            onChange={setProteinPerKg}
            unit="g/kg"
            step={0.1}
            min={0.5}
            max={4}
          />
          {!valid[4] && <FieldError msg="Please enter protein per kg." />}
          <div className="divider" />
          <div className="kv">
            <span className="k">Maintenance</span>
            <span className="v num">{plan.maintenance.toLocaleString()} kcal</span>
          </div>
          <div className="kv">
            <span className="k">Daily target</span>
            <span className="v num" style={{ color: 'var(--accent)' }}>
              {plan.target.toLocaleString()} kcal
            </span>
          </div>
          <div className="kv">
            <span className="k">
              {goal === 'cut' ? 'Deficit' : goal === 'bulk' ? 'Surplus' : 'Balance'}
            </span>
            <span className="v num">
              {goal === 'maintain' ? '0 kcal' : `${plan.dailyDeltaKcal > 0 ? '+' : ''}${plan.dailyDeltaKcal} kcal/day`}
            </span>
          </div>
          {goal !== 'maintain' && (
            <div className="kv">
              <span className="k">Expected pace</span>
              <span className="v num">
                {(plan.weeklyRateKg > 0 ? '+' : '') + (Math.round(plan.weeklyRateKg * 100) / 100)} kg/week
              </span>
            </div>
          )}
          <div className="kv">
            <span className="k">Protein / Carbs / Fat</span>
            <span className="v num">
              {macros.protein} / {macros.carbs} / {macros.fat} g
            </span>
          </div>
        </div>
      )}

      <div className="btn-row">
        {step > 0 && (
          <button className="btn ghost" style={{ flex: '0 0 34%' }} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button
            className="btn primary"
            disabled={!valid[step as keyof typeof valid]}
            onClick={() => setStep(step + 1)}
          >
            Continue
          </button>
        ) : (
          <button className="btn primary" disabled={saving || !valid[4]} onClick={finish}>
            {saving ? 'Saving…' : 'Start tracking'}
          </button>
        )}
      </div>
      <p className="tiny center" style={{ marginTop: 14 }}>
        Everything is stored on this device. Nothing is uploaded except meal photos you ask us to
        analyze.
      </p>
    </div>
  )
}
