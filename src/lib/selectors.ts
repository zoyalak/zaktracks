import type { ExtraTargets, Macro, MealEntry, Profile, WeightPoint } from './types'
import { addMacro, emptyMacro, mealToMacro, roundMacro } from './types'
import { goalPlan, macroTargets } from './nutrition'
import { lastNDays } from './date'

export interface Targets {
  maintenance: number
  goalKcal: number
  macro: Macro
  /** Daily goals for the extended macros (partial — whatever the AI chose). */
  extras: ExtraTargets
  /** Whether the split came from the AI or the standard formula. */
  macroSource: 'ai' | 'formula'
  weeklyRateKg: number
  dailyDeltaKcal: number
  clamped: boolean
  warning?: string
}

/** Everything the app needs to know about the current plan. */
export function targetsFor(profile: Profile): Targets {
  const plan = goalPlan(profile)
  const ai = profile.aiTargets
  const macro = ai
    ? { kcal: plan.target, protein: ai.protein, carbs: ai.carbs, fat: ai.fat }
    : macroTargets(profile, plan.target)
  return {
    maintenance: plan.maintenance,
    goalKcal: plan.target,
    macro: { kcal: macro.kcal, protein: macro.protein, carbs: macro.carbs, fat: macro.fat },
    extras: ai?.extras ?? {},
    macroSource: ai ? 'ai' : 'formula',
    weeklyRateKg: plan.weeklyRateKg,
    dailyDeltaKcal: plan.dailyDeltaKcal,
    clamped: plan.clamped,
    warning: plan.warning,
  }
}

export const mealsOnDate = (meals: MealEntry[], dateKey: string): MealEntry[] =>
  meals.filter((m) => m.date === dateKey).sort((a, b) => a.time.localeCompare(b.time))

export const totalsFor = (meals: MealEntry[], dateKey: string): Macro =>
  roundMacro(mealsOnDate(meals, dateKey).reduce((acc, m) => addMacro(acc, mealToMacro(m)), emptyMacro()))

export interface DayStat {
  date: string
  eaten: Macro
  goalKcal: number
  delta: number
  logged: boolean
}

export function weekStats(meals: MealEntry[], targets: Targets, days = 7, endKey?: string): DayStat[] {
  return lastNDays(days, endKey).map((date) => {
    const eaten = totalsFor(meals, date)
    return {
      date,
      eaten,
      goalKcal: targets.goalKcal,
      delta: eaten.kcal - targets.goalKcal,
      logged: eaten.kcal > 0,
    }
  })
}

export interface WeekSummary {
  days: DayStat[]
  avgEaten: number
  avgGoal: number
  totalDelta: number
  daysOnTarget: number
  loggedDays: number
  avgMacro: Macro
}

export function weekSummary(meals: MealEntry[], targets: Targets, days = 7, endKey?: string): WeekSummary {
  const list = weekStats(meals, targets, days, endKey)
  const logged = list.filter((d) => d.logged)
  const avg = (fn: (d: DayStat) => number): number =>
    logged.length ? Math.round(logged.reduce((s, d) => s + fn(d), 0) / logged.length) : 0
  const sumMacro = logged.reduce<Macro>((acc, d) => addMacro(acc, d.eaten), emptyMacro())
  const n = logged.length || 1
  return {
    days: list,
    avgEaten: avg((d) => d.eaten.kcal),
    avgGoal: targets.goalKcal,
    totalDelta: logged.reduce((s, d) => s + d.delta, 0),
    daysOnTarget: logged.filter((d) => d.eaten.kcal <= d.goalKcal + 100).length,
    loggedDays: logged.length,
    avgMacro: roundMacro({
      kcal: sumMacro.kcal / n,
      protein: sumMacro.protein / n,
      carbs: sumMacro.carbs / n,
      fat: sumMacro.fat / n,
    }),
  }
}

/** Weight entries sorted by date, newest last. */
export const sortedWeight = (log: WeightPoint[]): WeightPoint[] =>
  [...log].sort((a, b) => a.date.localeCompare(b.date))

export const lastWeight = (log: WeightPoint[]): WeightPoint | null => {
  const s = sortedWeight(log)
  return s.length ? s[s.length - 1] : null
}

/** Average daily intake implied by a weight change, for a reality check. */
export function impliedDailyDelta(weightLog: WeightPoint[], days = 14): number | null {
  const s = sortedWeight(weightLog).slice(-days)
  if (s.length < 2) return null
  const first = s[0]
  const last = s[s.length - 1]
  const daySpan = Math.max(
    1,
    Math.round((new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000),
  )
  return Math.round(((last.kg - first.kg) * 7700) / daySpan)
}
