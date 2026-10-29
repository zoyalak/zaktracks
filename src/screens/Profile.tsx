import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import type { ActivityKey, AppData, GoalType, Profile as ProfileType, Sex, UnitSystem } from '../lib/types'
import { ACTIVITY, defaultSplit, goalPlan, macroTargets } from '../lib/nutrition'
import { cmToFtIn, displayWeight, ftInToCm, fromKg, toKg, weightLabel } from '../lib/units'
import { ApiError, apiHealth, getAiTargets, type ApiHealth } from '../lib/api'
import { EXTRA_KEYS, EXTRA_META } from '../lib/types'
import { Disclosure, Field, FieldError, Loading, Notice, Segmented, Sheet } from '../components/ui'

type NumKey = 'weight' | 'age' | 'heightCm' | 'ft' | 'in' | 'target' | 'weeks' | 'protein'

/** What the You tab exposes to the tab bar so leaving mid-edit can ask first. */
export type ProfileGuard = {
  isDirty: () => boolean
  save: () => Promise<boolean>
  discard: () => void
}

/** Reminder per number field when the user leaves it empty. */
const NUM_MSG: Record<NumKey, string> = {
  weight: 'Please enter your weight.',
  age: 'Please enter your age.',
  heightCm: 'Please enter your height.',
  ft: 'Please enter your height.',
  in: 'Please enter your height.',
  target: 'Please enter your target weight.',
  weeks: 'Please enter the number of weeks.',
  protein: 'Please enter protein per kg.',
}

export default function Profile({ onGuard }: { onGuard?: (g: ProfileGuard | null) => void }) {
  const { profile, meals, foods, settings, saveProfile, importData, resetAll, storageMode } = useApp()
  const [draft, setDraft] = useState<ProfileType | null>(profile)
  const [saved, setSaved] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState<string | null>(null)
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [installable, setInstallable] = useState(false)
  const [dataMsg, setDataMsg] = useState<string | null>(null)
  const [raw, setRaw] = useState<Partial<Record<NumKey, string>>>({})
  const [fieldErr, setFieldErr] = useState<Partial<Record<NumKey, string>>>({})
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [healthPopup, setHealthPopup] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(profile)
  }, [profile])

  // Hand the tab bar a live view of this draft so leaving mid-edit can ask
  // "save changes?" — re-registered every render so it never goes stale.
  useEffect(() => {
    onGuard?.({
      isDirty: () =>
        JSON.stringify(draft) !== JSON.stringify(profile) ||
        Object.values(fieldErr).some(Boolean),
      save: () => (draft && profile ? commit() : Promise.resolve(false)),
      discard: () => {
        setDraft(profile)
        setRaw({})
        setFieldErr({})
        setSaveErr(null)
      },
    })
    return () => onGuard?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  useEffect(() => {
    apiHealth().then(setHealth)
    const onInstallable = () => setInstallable(true)
    window.addEventListener('macrolens:installable', onInstallable)
    return () => window.removeEventListener('macrolens:installable', onInstallable)
  }, [])

  const plan = useMemo(() => (draft ? goalPlan(draft) : null), [draft])
  const macros = useMemo(() => {
    if (!draft) return null
    const target = goalPlan(draft).target
    return draft.aiTargets
      ? { kcal: target, protein: draft.aiTargets.protein, carbs: draft.aiTargets.carbs, fat: draft.aiTargets.fat }
      : macroTargets(draft, target)
  }, [draft])

  if (!profile || !draft || !plan || !macros) return null

  const patch = (changes: Partial<ProfileType>) => {
    setDraft((prev) => (prev ? { ...prev, ...changes } : prev))
    setSaved(false)
    setSaveErr(null)
  }

  const changeUnits = (units: UnitSystem) => {
    if (units === draft.units) return
    setRaw({})
    setFieldErr({})
    patch({ units, weightKg: toKg(fromKg(draft.weightKg, units), units) })
  }

  /**
   * Number fields keep their raw text while editing: clearing a box shows an
   * empty field (never a forced 0) and raises that field's reminder.
   */
  const onNum = (key: NumKey, text: string, apply?: (n: number) => void) => {
    setRaw((r) => ({ ...r, [key]: text }))
    const empty = text.trim() === ''
    setFieldErr((e) => ({ ...e, [key]: empty ? NUM_MSG[key] : undefined }))
    setSaveErr(null)
    if (empty) return
    const n = parseFloat(text)
    if (Number.isFinite(n)) apply?.(n)
  }

  /** Raw text while a field is being edited, otherwise the plan's value. */
  const shown = (key: NumKey, fallback: string | number): string | number =>
    raw[key] !== undefined ? (raw[key] as string) : fallback

  /** Ask the AI for a split tailored to this profile; formula split stands if it fails. */
  const refreshAi = async (p: ProfileType) => {
    if (aiBusy) return
    setAiBusy(true)
    setAiMsg(null)
    try {
      const ai = await getAiTargets(p, goalPlan(p).target)
      await saveProfile({ ...p, aiTargets: { ...ai, at: Date.now() } })
    } catch (err) {
      setAiMsg(
        err instanceof ApiError && err.code === 'NO_API_KEY'
          ? 'The AI needs an OpenRouter key on the server — using the standard formula meanwhile.'
          : 'Could not reach the AI right now — using the standard formula meanwhile.',
      )
    } finally {
      setAiBusy(false)
    }
  }

  const commit = async (): Promise<boolean> => {
    // A number the user emptied blocks the save, with a reminder per field.
    const required: NumKey[] = ['weight', 'age', 'protein']
    if (draft.units === 'metric') required.push('heightCm')
    else required.push('ft', 'in')
    if (draft.goal !== 'maintain') required.push('target', 'weeks')
    const empties = required.filter((k) => raw[k] !== undefined && raw[k]!.trim() === '')
    if (empties.length > 0) {
      setFieldErr((prev) => {
        const next = { ...prev }
        for (const k of empties) next[k] = NUM_MSG[k]
        return next
      })
      setSaveErr([...new Set(empties.map((k) => NUM_MSG[k]))].join(' '))
      return false
    }

    // Too aggressive to be healthy: refuse to save a plan whose calories work
    // out to under 1,500 kcal/day (target weight × weeks drive that number).
    if (
      draft.goal !== 'maintain' &&
      Math.round(plan.maintenance + plan.dailyDeltaKcal) < 1500
    ) {
      setHealthPopup(true)
      return false
    }

    setSaveErr(null)
    await saveProfile(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
    setRaw({})
    setFieldErr({})
    // Changing the goal or schedule invalidates the AI split — refresh it.
    if (
      draft.goal !== profile.goal ||
      draft.targetWeightKg !== profile.targetWeightKg ||
      draft.weeks !== profile.weeks
    ) {
      void refreshAi(draft)
    }
    return true
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
        settings: { weightLog: Array.isArray(parsed.settings?.weightLog) ? parsed.settings.weightLog : [] },
      })
      setDataMsg('Backup restored.')
    } catch (err) {
      setDataMsg((err as Error).message || 'Could not read that file.')
    }
  }

  const ftin = cmToFtIn(draft.heightCm)
  const units = draft.units
  // Live ft/in while those boxes are being edited — the raw box wins over the
  // height it was derived from, so typing one side keeps the other honest.
  const liveIn =
    raw.in !== undefined && raw.in.trim() !== '' && Number.isFinite(parseFloat(raw.in))
      ? parseFloat(raw.in)
      : ftin.in
  const liveFt =
    raw.ft !== undefined && raw.ft.trim() !== '' && Number.isFinite(parseFloat(raw.ft))
      ? parseFloat(raw.ft)
      : ftin.ft

  return (
    <>
      <div className="topbar">
        <div>
          <div className="sub">
            {draft.goal === 'cut' ? 'Cutting' : draft.goal === 'bulk' ? 'Gaining' : 'Maintaining'} ·{' '}
            {plan.target.toLocaleString()} kcal/day
          </div>
          <h1>Your plan</h1>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Body & activity</h2>
          <span className="hint">Mifflin-St Jeor</span>
        </div>
        <Field label="Units">
          <Segmented
            options={[
              { value: 'metric', label: 'kg · cm' },
              { value: 'imperial', label: 'lb · ft' },
            ]}
            value={units}
            onChange={changeUnits}
          />
        </Field>
        <div className="field-row">
          <Field label={`Weight (${weightLabel(units)})`}>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step={0.5}
              value={shown('weight', Math.round(displayWeight(draft.weightKg, units) * 10) / 10)}
              onChange={(e) => onNum('weight', e.target.value, (n) => patch({ weightKg: toKg(n, units) }))}
            />
            <FieldError msg={fieldErr.weight} />
          </Field>
          <Field label="Age">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={shown('age', draft.age)}
              onChange={(e) => onNum('age', e.target.value, (n) => patch({ age: n }))}
            />
            <FieldError msg={fieldErr.age} />
          </Field>
        </div>
        <div className="field-row">
          {units === 'metric' ? (
            <Field label="Height (cm)">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={shown('heightCm', draft.heightCm)}
                onChange={(e) => onNum('heightCm', e.target.value, (n) => patch({ heightCm: n }))}
              />
              <FieldError msg={fieldErr.heightCm} />
            </Field>
          ) : (
            <>
              <Field label="Height (ft)">
                <input
                  className="input"
                  type="number"
                  value={shown('ft', ftin.ft)}
                  onChange={(e) => onNum('ft', e.target.value, (n) => patch({ heightCm: ftInToCm(n, liveIn) }))}
                />
                <FieldError msg={fieldErr.ft} />
              </Field>
              <Field label="Height (in)">
                <input
                  className="input"
                  type="number"
                  value={shown('in', ftin.in)}
                  onChange={(e) => onNum('in', e.target.value, (n) => patch({ heightCm: ftInToCm(liveFt, n) }))}
                />
                <FieldError msg={fieldErr.in} />
              </Field>
            </>
          )}
        </div>
        <Field label="Gender">
          <Segmented
            options={[
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
            ]}
            value={draft.sex}
            onChange={(v) => patch({ sex: v as Sex })}
          />
        </Field>
        <Field label="Activity level">
          <select
            className="input"
            value={draft.activity}
            onChange={(e) => patch({ activity: e.target.value as ActivityKey })}
          >
            {(Object.keys(ACTIVITY) as ActivityKey[]).map((key) => (
              <option key={key} value={key}>
                {ACTIVITY[key].label}
              </option>
            ))}
          </select>
          <div className="tiny mt">{ACTIVITY[draft.activity].hint}</div>
        </Field>
        <div className="total-strip">
          <span className="muted">Maintenance</span>
          <b className="num">{plan.maintenance.toLocaleString()} kcal</b>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Goal</h2>
          <span className="hint">{plan.target.toLocaleString()} kcal/day</span>
        </div>
        <Segmented
          options={[
            { value: 'maintain', label: 'Maintain' },
            { value: 'cut', label: 'Cut' },
            { value: 'bulk', label: 'Gain' },
          ]}
          value={draft.goal}
          onChange={(v) => {
            const goal = v as GoalType
            const split = defaultSplit(goal)
            patch({
              goal,
              targetWeightKg: goal === 'maintain' ? draft.weightKg : draft.targetWeightKg,
              proteinPerKg: split.proteinPerKg,
              fatPct: split.fatPct,
            })
          }}
        />
        {draft.goal !== 'maintain' && (
          <>
            <div className="field-row" style={{ marginTop: 13 }}>
              <Field label={`Target (${weightLabel(units)})`}>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step={0.5}
                  value={shown('target', Math.round(displayWeight(draft.targetWeightKg, units) * 10) / 10)}
                  onChange={(e) =>
                    onNum('target', e.target.value, (n) => patch({ targetWeightKg: toKg(n, units) }))
                  }
                />
                <FieldError msg={fieldErr.target} />
              </Field>
              <Field label="Weeks">
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={260}
                  value={shown('weeks', draft.weeks)}
                  onChange={(e) =>
                    onNum('weeks', e.target.value, (n) => patch({ weeks: Math.max(1, Math.round(n)) }))
                  }
                />
                <FieldError msg={fieldErr.weeks} />
              </Field>
            </div>
            <div className="kv">
              <span className="k">Pace</span>
              <span className="v num">
                {(plan.weeklyRateKg > 0 ? '+' : '') + (Math.round(plan.weeklyRateKg * 100) / 100)} kg/week
              </span>
            </div>
            <div className="kv">
              <span className="k">
                {draft.goal === 'cut' ? 'Daily deficit' : 'Daily surplus'}
              </span>
              <span className="v num">
                {Math.abs(plan.dailyDeltaKcal).toLocaleString()} kcal
              </span>
            </div>
          </>
        )}
        {plan.clamped && plan.warning && <div className="notice" style={{ marginTop: 12 }}>{plan.warning}</div>}
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Macro targets</h2>
          <span className="hint">
            {draft.aiTargets ? "today's AI-set split" : `sums to ${plan.target.toLocaleString()} kcal`}
          </span>
        </div>
        {draft.aiTargets && (
          <p className="tiny" style={{ marginTop: -4, marginBottom: 10 }}>
            <span className="chip" style={{ color: 'var(--accent)' }}>✨ AI-set</span>{' '}
            {draft.aiTargets.rationale || 'A split tailored to your body, activity and goal.'}
          </p>
        )}
        <Field label="Protein per kg of goal weight">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            step={0.1}
            value={shown('protein', draft.proteinPerKg)}
            onChange={(e) => onNum('protein', e.target.value, (n) => patch({ proteinPerKg: n }))}
          />
          <FieldError msg={fieldErr.protein} />
        </Field>
        <div className="kv">
          <span className="k">Protein</span>
          <span className="v num">{macros.protein} g</span>
        </div>
        <div className="kv">
          <span className="k">Carbs</span>
          <span className="v num">{macros.carbs} g</span>
        </div>
        <div className="kv">
          <span className="k">Fat</span>
          <span className="v num">{macros.fat} g</span>
        </div>

        <Disclosure title="More macros" hint={draft.aiTargets ? undefined : 'not set yet'}>
          {EXTRA_KEYS.map((k) => {
            const goal = draft.aiTargets?.extras[k]
            return (
              <div className="kv" key={k}>
                <span className="k">{EXTRA_META[k].label}</span>
                <span className="v num">
                  {goal && goal > 0 ? `${goal} ${EXTRA_META[k].unit}/day` : '—'}
                </span>
              </div>
            )
          })}
        </Disclosure>

        {aiBusy ? (
          <Loading label="Generating healthy goals..." />
        ) : (
          <button className="btn mt" onClick={() => void refreshAi(draft)}>
            ✨ {draft.aiTargets ? 'Regenerate goals with AI' : 'Generate my goals with AI'}
          </button>
        )}
        {aiMsg && <Notice type="warn">{aiMsg}</Notice>}
      </div>

      {saveErr && <Notice type="error">{saveErr}</Notice>}
      <button className="btn primary" onClick={() => void commit()}>
        {saved ? '✓ Saved' : 'Save changes'}
      </button>

      {healthPopup && (
        <Sheet
          open
          onClose={() => setHealthPopup(false)}
          title="Not healthy! Please set sustainable goals (1500+ calories/day)"
          sub={`${Math.round(plan.maintenance + plan.dailyDeltaKcal).toLocaleString()} kcal/day is below the safe minimum — stretch the weeks out or soften the target weight.`}
        >
          <button className="btn primary" onClick={() => setHealthPopup(false)}>
            Got it
          </button>
        </Sheet>
      )}

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
            (free, via OpenRouter) as the fallback — both keyed on the server so they never
            reach your phone. Add the keys, then redeploy:
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

      <div className="section-label">Your data</div>
      <div className="card">
        <div className="kv">
          <span className="k">Stored on</span>
          <span className="v">{storageMode === 'indexeddb' ? 'This device (IndexedDB)' : 'This browser (localStorage)'}</span>
        </div>
        <p className="tiny" style={{ marginBottom: 12 }}>
          Nothing leaves your phone except photos you ask us to analyze. Export regularly — clearing
          browser data removes your log.
        </p>
        <div className="btn-row">
          <button className="btn" onClick={exportData}>
            ⬇️ Export
          </button>
          <button className="btn" onClick={() => importInput.current?.click()}>
            ⬆️ Import
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
            📲 Install app on this phone
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

      <p className="tiny center" style={{ marginTop: 18 }}>          ZakTracks v1.0 · calorie targets are estimates, not medical advice.
      </p>
    </>
  )
}
