import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { normalizeSettings, type AppData, type FuelPlan, type UnitSystem } from '../lib/types'
import { eatenKcalOn } from '../lib/selectors'
import { KCAL_PER_KG } from '../lib/nutrition'
import { todayKey } from '../lib/date'
import { MAX_DEFICIT_KCAL, MAX_DEFICIT_SHARE, fuelBreakdown, fuelDeficitLimit } from '../lib/fuel'
import { displayWeight, toKg, weightLabel } from '../lib/units'
import { apiHealth, type ApiHealth } from '../lib/api'
import { Field, Notice, Segmented } from '../components/ui'
import { Icon } from '../components/icons'
import { FuelSetupForm } from '../components/FuelPanel'
import ModeSwitch from '../components/ModeSwitch'

/** What the You tab exposes to the tab bar so leaving mid-edit can ask first. */
export type ProfileGuard = {
  isDirty: () => boolean
  save: () => Promise<boolean>
  discard: () => void
}

const num = (v: string): number => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The You screen: the setup behind today's goal, the deficit that would get
 * you to a target weight in a set time, the macro targets the whole app uses,
 * and the account/data bits.
 */
export default function Profile({
  onGuard: _onGuard,
}: {
  onGuard?: (g: ProfileGuard | null) => void
}) {
  const {
    profile,
    meals,
    foods,
    settings,
    saveProfile,
    saveFuel,
    importData,
    resetAll,
    storageMode,
    user,
    signOut,
  } = useApp()

  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [installable, setInstallable] = useState(false)
  const [dataMsg, setDataMsg] = useState<string | null>(null)
  const [targetText, setTargetText] = useState('')
  const [weeksText, setWeeksText] = useState('')
  const [applied, setApplied] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiHealth().then(setHealth)
    const onInstallable = () => setInstallable(true)
    window.addEventListener('macrolens:installable', onInstallable)
    return () => window.removeEventListener('macrolens:installable', onInstallable)
  }, [])

  // Seed the target-weight boxes from the profile, and keep them honest when
  // units or the plan change elsewhere.
  useEffect(() => {
    if (!profile) return
    setTargetText(String(displayWeight(profile.targetWeightKg, profile.units)))
    setWeeksText(String(profile.weeks))
  }, [profile?.targetWeightKg, profile?.weeks, profile?.units])

  if (!profile) return null

  const units = profile.units
  const plan = settings.fuel ?? null
  const fuel = fuelBreakdown(plan, settings.fuelDays, todayKey(), (d) => eatenKcalOn(meals, d))

  const saveSetup = async (next: FuelPlan) => {
    await saveFuel(next)
    // Keep the profile's body stats in step with the setup — weight trends and
    // the fallback plan read them.
    await saveProfile({
      ...profile,
      age: next.age,
      sex: next.sex,
      heightCm: next.heightCm,
      weightKg: next.weightKg,
    })
  }

  const targetKg = toKg(num(targetText), units)
  const weeks = Math.max(1, Math.round(num(weeksText)) || 1)
  const deltaKg = (plan?.weightKg ?? profile.weightKg) - targetKg
  const deficitNeeded = Math.round((deltaKg * KCAL_PER_KG) / (weeks * 7))
  const limit = plan ? fuelDeficitLimit(plan) : 0
  const deficitToUse = Math.max(0, Math.min(deficitNeeded, limit))
  const overLimit = deficitNeeded > limit

  const applyDeficit = async () => {
    if (!plan || deficitNeeded <= 0) return
    await saveFuel({ ...plan, deficitKcal: deficitToUse })
    await saveProfile({ ...profile, targetWeightKg: targetKg, weeks })
    setApplied(true)
    setTimeout(() => setApplied(false), 2200)
  }

  const changeUnits = async (next: UnitSystem) => {
    if (next === units) return
    await saveProfile({ ...profile, units: next })
  }

  const exportData = () => {
    const payload: AppData = { profile, meals, foods, settings }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zaktracks-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const doImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppData
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.meals)) {
        throw new Error('That file does not look like a ZakTracks export.')
      }
      await importData({
        profile: parsed.profile ?? null,
        meals: parsed.meals,
        foods: Array.isArray(parsed.foods) ? parsed.foods : [],
        // A restored backup keeps the app mode and Fuel setup it carried.
        settings: normalizeSettings(parsed.settings),
      })
      setDataMsg('Backup restored.')
    } catch (err) {
      setDataMsg((err as Error).message || 'Could not read that file.')
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="sub">
            {fuel ? `Today's goal · ${fuel.receipt.goalKcal.toLocaleString()} kcal` : 'Your setup'}
          </div>
          <h1>Your plan</h1>
        </div>
      </div>

      <ModeSwitch />

      <div className="card">
        <div className="card-title">
          <h2>Goal setup</h2>
          <span className="hint">BMR × 1.2</span>
        </div>
        <Field label="Units">
          <Segmented
            options={[
              { value: 'metric', label: 'kg · cm' },
              { value: 'imperial', label: 'lb · ft' },
            ]}
            value={units}
            onChange={(v) => void changeUnits(v as UnitSystem)}
          />
        </Field>
        <FuelSetupForm units={units} initial={plan} onSave={saveSetup} />
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Deficit for your target</h2>
          <span className="hint">what the pace costs</span>
        </div>
        <div className="field-row">
          <Field label={`Target weight (${weightLabel(units)})`}>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step={0.5}
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
            />
          </Field>
          <Field label="Weeks">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={260}
              value={weeksText}
              onChange={(e) => setWeeksText(e.target.value)}
            />
          </Field>
        </div>

        {deltaKg > 0 ? (
          <>
            <div className="kv">
              <span className="k">To lose</span>
              <span className="v num">
                {Math.round(deltaKg * 10) / 10} kg in {weeks} {weeks === 1 ? 'week' : 'weeks'}
              </span>
            </div>
            <div className="kv">
              <span className="k">Daily deficit needed</span>
              <span className="v num" style={{ color: 'var(--accent)' }}>
                {deficitNeeded.toLocaleString()} kcal
              </span>
            </div>
            <div className="kv">
              <span className="k">That's a pace of</span>
              <span className="v num">{Math.round((deltaKg / weeks) * 100) / 100} kg/week</span>
            </div>
            {plan && (
              <>
                <button
                  className="btn primary mt"
                  disabled={overLimit}
                  onClick={() => void applyDeficit()}
                >
                  {applied ? '✓ Deficit updated' : `Use ${deficitToUse.toLocaleString()} kcal deficit`}
                </button>
                {overLimit && (
                  <Notice type="warn">
                    That pace needs more than the safe limit of{' '}
                    <b>{limit.toLocaleString()} kcal</b> a day (up to{' '}
                    {Math.round(MAX_DEFICIT_SHARE * 100)}% of your base burn and{' '}
                    {MAX_DEFICIT_KCAL} kcal overall). Add a few weeks and the deficit drops.
                  </Notice>
                )}
              </>
            )}
          </>
        ) : (
          <Notice type="info">
            Enter a target below your current weight to see the daily deficit that gets you there.
            The date drives it: more weeks, smaller deficit.
          </Notice>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Macro targets</h2>
          <span className="hint">same numbers across the app</span>
        </div>
        {fuel ? (
          <>
            <div className="kv">
              <span className="k">Protein</span>
              <span className="v num" style={{ color: 'var(--protein)' }}>
                {fuel.macro.protein} g
              </span>
            </div>
            <div className="kv">
              <span className="k">Carbs</span>
              <span className="v num" style={{ color: 'var(--carbs)' }}>
                {fuel.macro.carbs} g
              </span>
            </div>
            <div className="kv">
              <span className="k">Fat</span>
              <span className="v num" style={{ color: 'var(--fat)' }}>
                {fuel.macro.fat} g
              </span>
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              1.8 g protein per kg, 28% of the goal from fat, carbs fill the rest — from today's{' '}
              {fuel.receipt.goalKcal.toLocaleString()} kcal goal, so Track, the meal sheet and Logs
              all measure against these.
            </p>
          </>
        ) : (
          <p className="tiny muted" style={{ margin: 0 }}>
            Save the setup above and your protein, carbs and fat targets appear here.
          </p>
        )}
      </div>

      <div className="section-label">AI analysis</div>
      <div className="card">
        <div className="kv">
          <span className="k">Vision service</span>
          <span className="v" style={{ color: health?.hasKey ? 'var(--accent)' : 'var(--warn)' }}>
            {health === null ? 'checking…' : health.hasKey ? `ready · ${health.model}` : 'not configured'}
          </span>
        </div>
        {health && !health.hasKey && (
          <Notice type="info">
            Photo and label analysis run through Groq's Qwen3.8 27B, with Nemotron 3.5 Super VL
            (free, via OpenRouter) as the fallback — both keyed on the server so they never reach
            your phone. Add the keys, then redeploy:
            <br />
            <br />
            <b>Deployed app:</b> Sites → your project → Secrets → add <b>GROQ_API_KEY</b>
            (console.groq.com/keys) and <b>OPENROUTER_API_KEY</b> (openrouter.ai/keys), then
            redeploy.
            <br />
            <b>Local build:</b> copy <b>worker/.dev.vars.example</b> to <b>worker/.dev.vars</b> and
            paste the key.
            <br />
            <br />
            Until then, describing a meal still works offline.
          </Notice>
        )}
      </div>

      <div className="section-label">Your account</div>
      <div className="card">
        <div className="kv">
          <span className="k">Signed in as</span>
          <span className="v">{user?.email ?? '—'}</span>
        </div>
        <div className="kv">
          <span className="k">Local cache</span>
          <span className="v">
            {storageMode === 'indexeddb' ? 'This device (IndexedDB)' : 'This browser (localStorage)'}
          </span>
        </div>
        <p className="tiny" style={{ marginBottom: 12 }}>
          Your logs are saved to your account and synced to every device you sign in on. Signing out
          removes the copy stored on this phone.
        </p>
        <div className="btn-row">
          <button className="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>

      <div className="section-label">Export &amp; import</div>
      <div className="card">
        <p className="tiny" style={{ marginBottom: 12 }}>
          Export a copy of everything to a file, or load a previous export back in.
        </p>
        <div className="btn-row">
          <button className="btn" onClick={exportData}>
            <Icon name="download" size={16} />
            Export
          </button>
          <button className="btn" onClick={() => importInput.current?.click()}>
            <Icon name="upload" size={16} />
            Import
          </button>
        </div>
        <input
          ref={importInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void doImport(f)
            e.target.value = ''
          }}
        />
        {dataMsg && <p className="tiny mt">{dataMsg}</p>}
        {installable && (
          <button className="btn mt" onClick={() => window.dispatchEvent(new Event('macrolens:install'))}>
            <Icon name="phone" size={16} />
            Install app on this phone
          </button>
        )}
        <button
          className="btn danger mt"
          onClick={async () => {
            if (confirm('Erase your profile, meals and custom foods on this device?')) {
              await resetAll()
            }
          }}
        >
          Erase all data
        </button>
      </div>

      <p className="tiny center" style={{ marginTop: 18 }}>
        ZakTracks v1.0 · calorie targets are estimates, not medical advice.
      </p>
    </>
  )
}
