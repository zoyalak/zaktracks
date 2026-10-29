import { useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import { targetsFor, weekSummary, sortedWeight } from '../lib/selectors'
import { keyToDate } from '../lib/date'
import { displayWeight, weightLabel } from '../lib/units'
import { MacroBar, Notice, Segmented } from '../components/ui'

export default function Week() {
  const { profile, meals, settings } = useApp()
  const [days, setDays] = useState<'7' | '14' | '30'>('7')

  const summary = useMemo(() => {
    if (!profile) return null
    return weekSummary(meals, targetsFor(profile), Number(days))
  }, [meals, profile, days])

  const weight = useMemo(() => sortedWeight(settings.weightLog).slice(-14), [settings.weightLog])

  if (!profile || !summary) return null
  const targets = targetsFor(profile)
  const scale = Math.max(targets.goalKcal * 1.25, ...summary.days.map((d) => d.eaten.kcal)) || 1
  const goalPct = Math.min(100, (targets.goalKcal / scale) * 100)
  const adherence =
    summary.loggedDays > 0
      ? Math.round(
          Math.max(0, 100 - (Math.abs(summary.totalDelta) / (summary.loggedDays * targets.goalKcal)) * 100),
        )
      : 0

  return (
    <>
      <div className="topbar">
        <div>
          <div className="sub">Intake vs target</div>
          <h1>Your Logs</h1>
        </div>
      </div>

      <Segmented
        options={[
          { value: '7', label: '7 days' },
          { value: '14', label: '14 days' },
          { value: '30', label: '30 days' },
        ]}
        value={days}
        onChange={(v) => setDays(v)}
      />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">
          <h2>Calories eaten</h2>
          <span className="hint">goal {targets.goalKcal.toLocaleString()} kcal</span>
        </div>
        <div className="chart">
          <div className="chart-goal" style={{ bottom: `${goalPct}%` }}>
            <span>goal</span>
          </div>
          {summary.days.map((d) => {
            const h = (d.eaten.kcal / scale) * 100
            const over = d.eaten.kcal > d.goalKcal
            return (
              <div key={d.date} className={`bar-col${d.date === summary.days[summary.days.length - 1].date ? ' today' : ''}`}>
                <div
                  className={`bar${d.logged ? (over ? ' over' : '') : ' empty'}`}
                  style={{ height: `${Math.max(d.logged ? 3 : 1.5, h)}%` }}
                >
                  {d.logged && Number(days) <= 14 && (
                    <span className="bar-val">{Math.round(d.eaten.kcal)}</span>
                  )}
                </div>
                <span className="bar-label">
                  {keyToDate(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })}
                </span>
              </div>
            )
          })}
        </div>
        <div className="legend">
          <span>
            <i style={{ background: 'var(--accent)' }} /> under goal
          </span>
          <span>
            <i style={{ background: 'var(--danger)' }} /> over goal
          </span>
          <span>
            <i style={{ background: 'rgba(255,255,255,.18)' }} /> not logged
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Summary</h2>
          <span className="hint">{summary.loggedDays} days logged</span>
        </div>
        <div className="kv">
          <span className="k">Average eaten</span>
          <span className="v num">{summary.avgEaten.toLocaleString()} kcal</span>
        </div>
        <div className="kv">
          <span className="k">Average goal</span>
          <span className="v num">{summary.avgGoal.toLocaleString()} kcal</span>
        </div>
        <div className="kv">
          <span className="k">Total balance</span>
          <span
            className="v num"
            style={{ color: summary.totalDelta <= 0 ? 'var(--accent)' : 'var(--danger)' }}
          >
            {summary.totalDelta > 0 ? '+' : ''}
            {summary.totalDelta.toLocaleString()} kcal
          </span>
        </div>
        <div className="kv">
          <span className="k">Days within goal</span>
          <span className="v num">
            {summary.daysOnTarget} / {summary.loggedDays || 0}
          </span>
        </div>
        <div className="kv">
          <span className="k">Expected change</span>
          <span className="v num">
            {targets.dailyDeltaKcal === 0
              ? 'hold steady'
              : `${((targets.dailyDeltaKcal * (summary.loggedDays || 0)) / 7700).toFixed(2)} kg`}
          </span>
        </div>
      </div>

      {summary.loggedDays > 0 && (
        <div className="card">
          <div className="card-title">
            <h2>Average macros</h2>
            <span className="hint">per logged day</span>
          </div>
          <div className="macro-grid">
            <MacroBar name="Protein" tone="protein" value={summary.avgMacro.protein} target={targets.macro.protein} />
            <MacroBar name="Carbs" tone="carbs" value={summary.avgMacro.carbs} target={targets.macro.carbs} />
            <MacroBar name="Fat" tone="fat" value={summary.avgMacro.fat} target={targets.macro.fat} />
          </div>
        </div>
      )}

      {weight.length >= 2 && <WeightTrend points={weight} profile={profile} />}

      {summary.loggedDays === 0 && (
        <Notice type="info">
          Log a few meals and this chart fills in automatically — calories eaten against what your
          plan calls for, day by day.
        </Notice>
      )}
      {summary.loggedDays > 0 && adherence < 70 && summary.totalDelta > 0 && (
        <Notice>
          You're averaging {Math.round(summary.totalDelta / summary.loggedDays).toLocaleString()} kcal
          above plan per logged day. At that pace the scale drifts up by about{' '}
          {((summary.totalDelta / 7700 / summary.loggedDays) * 7 * 1000).toFixed(1)} g per week.
        </Notice>
      )}
    </>
  )
}

function WeightTrend({
  points,
  profile,
}: {
  points: { date: string; kg: number }[]
  profile: { units: 'metric' | 'imperial'; targetWeightKg: number }
}) {
  const w = 320
  const h = 92
  const values = points.map((p) => p.kg)
  const target = profile.targetWeightKg
  const min = Math.min(...values, target) - 1
  const max = Math.max(...values, target) + 1
  const span = Math.max(0.5, max - min)
  const x = (i: number) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * (w - 20) + 10)
  const y = (kg: number) => h - 10 - ((kg - min) / span) * (h - 20)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ')
  const first = values[0]
  const last = values[values.length - 1]
  const delta = last - first

  return (
    <div className="card">
      <div className="card-title">
        <h2>Weight trend</h2>
        <span className="hint">
          {delta > 0 ? '+' : ''}
          {(Math.round(delta * 10) / 10).toFixed(1)} {weightLabel(profile.units)}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ overflow: 'visible' }}>
        <line
          x1={0}
          x2={w}
          y1={y(target)}
          y2={y(target)}
          stroke="rgba(176,138,98,.7)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
        />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.kg)} r={i === points.length - 1 ? 4 : 2.5} fill="var(--accent)" />
        ))}
      </svg>
      <div className="row between tiny" style={{ marginTop: 6 }}>
        <span>
          {displayWeight(first, profile.units)} {weightLabel(profile.units)}
        </span>
        <span style={{ color: 'var(--fat)' }}>
          target {displayWeight(target, profile.units)} {weightLabel(profile.units)}
        </span>
        <span>
          {displayWeight(last, profile.units)} {weightLabel(profile.units)}
        </span>
      </div>
    </div>
  )
}
