import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { formatDayLabel, formatDayName, shiftKey, todayKey } from '../lib/date'
import { mealsOnDate, targetsFor, totalsFor } from '../lib/selectors'
import { displayWeight, toKg, weightLabel } from '../lib/units'
import type { ExtraMacros, MealEntry } from '../lib/types'
import { EXTRA_KEYS, EXTRA_META, addExtras, emptyExtras, mealToExtras } from '../lib/types'
import AddMealSheet from '../components/AddMealSheet'
import MealSheet from '../components/MealSheet'
import { Disclosure, Field, MacroBar, Notice, ProgressRing, Sheet } from '../components/ui'

export default function Today() {
  const { profile, meals, settings, upsertMeal, removeMeal, logWeight } = useApp()
  const [date, setDate] = useState(todayKey())
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<{ meal: MealEntry; isNew: boolean } | null>(null)
  const [weighOpen, setWeighOpen] = useState(false)
  const [weightInput, setWeightInput] = useState('')

  if (!profile) return null
  const targets = targetsFor(profile)
  const dayMeals = mealsOnDate(meals, date)
  const totals = totalsFor(meals, date)
  const dayExtras: ExtraMacros = dayMeals.reduce(
    (acc, m) => addExtras(acc, mealToExtras(m)),
    emptyExtras(),
  )
  const remaining = targets.goalKcal - totals.kcal
  const isToday = date === todayKey()
  const latestWeight = settings.weightLog.length
    ? [...settings.weightLog].sort((a, b) => b.date.localeCompare(a.date))[0].kg
    : profile.weightKg

  const rings = useMemo(
    () => ({
      eaten: Math.min(totals.kcal, targets.goalKcal),
      goal: targets.goalKcal,
    }),
    [totals.kcal, targets.goalKcal],
  )

  const saveEdit = async (meal: MealEntry) => {
    await upsertMeal(meal)
    setEditing(null)
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="sub">{formatDayName(date)}</div>
          <h1>{formatDayLabel(date, { day: 'numeric', month: 'long' })}</h1>
        </div>
        <div className="row" style={{ gap: 7 }}>
          <button className="icon-btn" aria-label="Previous day" onClick={() => setDate((d) => shiftKey(d, -1))}>
            ‹
          </button>
          <button
            className="icon-btn"
            aria-label="Next day"
            disabled={date >= todayKey()}
            style={{ opacity: date >= todayKey() ? 0.35 : 1 }}
            onClick={() => setDate((d) => shiftKey(d, 1))}
          >
            ›
          </button>
        </div>
      </div>

      <div className="card">
        <div className="ring-wrap">
          <ProgressRing
            value={rings.eaten}
            max={rings.goal}
            color={remaining >= 0 ? 'var(--accent)' : 'var(--danger)'}
          >
            <span className="ring-value num">{Math.abs(remaining).toLocaleString()}</span>
            <span className="ring-label">{remaining >= 0 ? 'kcal left' : 'kcal over'}</span>
          </ProgressRing>
          <div className="ring-stats">
            <div className="stat-row">
              <span className="k">
                <i className="dot" style={{ background: 'var(--accent)' }} /> Energy
              </span>
              <span className="v num">
                {totals.kcal.toLocaleString()} / {targets.goalKcal.toLocaleString()}
              </span>
            </div>
            <div className="stat-row">
              <span className="k">
                <i className="dot" style={{ background: 'rgba(255,255,255,.3)' }} /> Maintenance
              </span>
              <span className="v num">{targets.maintenance.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Macros</h2>
          <span className="hint">Targets</span>
        </div>
        <div className="macro-grid">
          <MacroBar name="Protein" tone="protein" value={totals.protein} target={targets.macro.protein} />
          <MacroBar name="Carbs" tone="carbs" value={totals.carbs} target={targets.macro.carbs} />
          <MacroBar name="Fat" tone="fat" value={totals.fat} target={targets.macro.fat} />
        </div>

        <Disclosure title="More macros" hint={targets.macroSource === 'ai' ? undefined : 'daily totals'}>
          {EXTRA_KEYS.map((k) => {
            const goal = targets.extras[k]
            const unit = EXTRA_META[k].unit
            if (goal && goal > 0) {
              return (
                <MacroBar
                  key={k}
                  name={EXTRA_META[k].label}
                  tone="muted"
                  color="rgba(242,236,223,0.85)"
                  unit={unit}
                  value={dayExtras[k]}
                  target={goal}
                  decimals={unit === 'mg' ? 0 : 1}
                />
              )
            }
            return (
              <div className="kv" key={k}>
                <span className="k">{EXTRA_META[k].label}</span>
                <span className="v num">
                  {dayExtras[k]} {unit}
                </span>
              </div>
            )
          })}
        </Disclosure>
      </div>

      <div className="card tight">
        <div className="row between">
          <div>
            <div className="tiny">Current weight</div>
            <div className="big-number num" style={{ fontSize: 24 }}>
              {displayWeight(latestWeight, profile.units)}{' '}
              <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{weightLabel(profile.units)}</span>
            </div>
            {targets.weeklyRateKg !== 0 && (
              <div className="tiny">
                target {displayWeight(profile.targetWeightKg, profile.units)} {weightLabel(profile.units)} ·{' '}
                {(targets.weeklyRateKg > 0 ? '+' : '') + (Math.round(targets.weeklyRateKg * 100) / 100)} kg/week
              </div>
            )}
          </div>
          <button
            className="btn small"
            onClick={() => {
              setWeightInput(String(displayWeight(latestWeight, profile.units)))
              setWeighOpen(true)
            }}
          >
            Log weight
          </button>
        </div>
      </div>

      <div className="card-title" style={{ marginTop: 4 }}>
        <h2>{isToday ? "Today's meals" : `Meals · ${formatDayLabel(date, { day: 'numeric', month: 'short' })}`}</h2>
        <span className="hint">{dayMeals.length} logged</span>
      </div>

      {dayMeals.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="big" aria-hidden>
              🍽️
            </span>
            Nothing logged yet. Tap <b>+</b> to snap a photo of your meal or describe it.
          </div>
        </div>
      ) : (
        dayMeals.map((meal) => {
          const kcal = meal.items.reduce((s, i) => s + i.kcal, 0)
          const p = meal.items.reduce((s, i) => s + i.protein, 0)
          const c = meal.items.reduce((s, i) => s + i.carbs, 0)
          const f = meal.items.reduce((s, i) => s + i.fat, 0)
          return (
            <button key={meal.id} className="meal" onClick={() => setEditing({ meal, isNew: false })}>
              {meal.photo ? (
                <img className="meal-thumb" src={meal.photo} alt="" />
              ) : (
                <span className="meal-thumb" aria-hidden>
                  {meal.source === 'food' ? '🥗' : meal.source === 'describe' ? '🗣️' : '🍽️'}
                </span>
              )}
              <span className="meal-body">
                <span className="meal-name">{meal.name}</span>
                <span className="meal-meta">
                  <span>{meal.time}</span>
                  <span className="chip p">{Math.round(p)}P</span>
                  <span className="chip c">{Math.round(c)}C</span>
                  <span className="chip f">{Math.round(f)}F</span>
                </span>
              </span>
              <span className="meal-kcal">
                <b className="num">{Math.round(kcal)}</b>
                <span>kcal</span>
              </span>
            </button>
          )
        })
      )}

      {remaining < 0 && isToday && (
        <Notice type="error">
          You're <b>{Math.abs(remaining).toLocaleString()} kcal</b> over today's goal. A 30-minute
          walk burns roughly 150 kcal — or just let tomorrow's deficit even it out.
        </Notice>
      )}

      <button className="fab" aria-label="Add meal" onClick={() => setAdding(true)}>
        +
      </button>

      <AddMealSheet
        open={adding}
        onClose={() => setAdding(false)}
        date={date}
        goalKcal={targets.goalKcal}
        remaining={remaining}
      />

      {editing && (
        <MealSheet
          meal={editing.meal}
          isNew={editing.isNew}
          goalKcal={targets.goalKcal}
          remainingBefore={remaining + editing.meal.items.reduce((s, i) => s + i.kcal, 0)}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          onDelete={(id) => void removeMeal(id)}
        />
      )}

      <Sheet open={weighOpen} onClose={() => setWeighOpen(false)} title="Log today's weight" sub="Used for your pace and trend.">
        <Field label={`Weight (${weightLabel(profile.units)})`}>
          <div className="suffix">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step={0.1}
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
            />
            <span className="unit">{weightLabel(profile.units)}</span>
          </div>
        </Field>
        <button
          className="btn primary"
          disabled={!parseFloat(weightInput)}
          onClick={() => {
            void logWeight(toKg(parseFloat(weightInput), profile.units), date)
            setWeighOpen(false)
          }}
        >
          Save weight
        </button>
      </Sheet>
    </>
  )
}
