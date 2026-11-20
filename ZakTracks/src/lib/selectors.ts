import type { ExtraTargets, Macro, MealEntry, Profile, WeightPoint } from './types'
import { addMacro, emptyMacro, mealToMacro, roundMacro } from './types'
import { goalPlan, macroTargets } from './nutrition'
import { keyToDate, lastNDays, shiftKey, todayKey } from './date'

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

/**
 * Everything the app needs to know about the current plan.
 *
 * When the Fuel tab has been set up, its goal for the day (base + movement −
 * deficit) becomes the target every food comparison uses; the profile plan is
 * only the fallback for an account that hasn't done Fuel setup.
 */
export function targetsFor(
  profile: Profile,
  fuel?: { goalKcal: number; macro: Macro } | null,
): Targets {
  const plan = goalPlan(profile)
  if (fuel) {
    const dailyDeltaKcal = fuel.goalKcal - plan.maintenance
    return {
      maintenance: plan.maintenance,
      goalKcal: fuel.goalKcal,
      macro: { ...fuel.macro, kcal: fuel.goalKcal },
      extras: {},
      macroSource: 'formula',
      weeklyRateKg: (dailyDeltaKcal * 7) / 7700,
      dailyDeltaKcal,
      clamped: false,
    }
  }
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
      // A day counts as logged when it holds a meal, even if its items add up to 0.
      logged: mealsOnDate(meals, date).length > 0,
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

/** How far above the daily goal the allowance may go to make up a deficit. */
const MAKEUP_CAP_KCAL = 300

export interface WeekAverage {
  /**
   * Average daily calories over the days logged earlier this week. The day
   * being viewed is not counted — it isn't finished yet — so it only enters
   * the average once it has ended. Null when no earlier day was logged.
   */
  avg: number | null
  daysLogged: number
  /** Days from the day being viewed through Sunday, today included. */
  daysLeft: number
  /**
   * Calories a day for those remaining days that would finish the week at the
   * goal (the average is taken over logged days). Null when the week's budget
   * is already spent, so no daily amount can pull the average back under.
   */
  perDay: number | null
  /** Monday and Sunday keys of the week in question. */
  from: string
  to: string
}

/**
 * Average daily intake for the Monday–Sunday week holding `endKey`, counting
 * only days before `endKey` that were logged — a day still in progress isn't
 * averaged, and a half-finished week shouldn't read as a starvation week —
 * plus the daily allowance that would keep the week's average at the goal.
 */
export function weekAverage(
  meals: MealEntry[],
  goalKcal: number,
  endKey: string = todayKey(),
): WeekAverage {
  const dow = (keyToDate(endKey).getDay() + 6) % 7 // 0 = Monday
  const monday = shiftKey(endKey, -dow)
  const sunday = shiftKey(monday, 6)
  let eaten = 0
  let days = 0
  for (let i = 0; i < 7; i++) {
    const key = shiftKey(monday, i)
    // The day being viewed is still in progress: it counts as one of the days
    // left to fill, not as a day already averaged.
    if (key >= endKey) break
    // Days without a log are left out entirely: they are unknown, not zero.
    if (mealsOnDate(meals, key).length === 0) continue
    eaten += totalsFor(meals, key).kcal
    days += 1
  }
  const daysLeft = 7 - dow
  // Each remaining day adds one more day to the average's denominator, so the
  // week's allowance is the goal times (logged + remaining).
  const remaining = goalKcal * (days + daysLeft) - eaten
  const spread = remaining > 0 ? Math.floor((remaining - 1) / daysLeft) : null
  return {
    avg: days ? Math.round(eaten / days) : null,
    daysLogged: days,
    daysLeft,
    // One kcal under the even split, so the week lands below the goal rather
    // than dead on it. Catching up on a deficit is capped so a big logged
    // deficit can't turn the last day of the week into an eating contest.
    perDay: spread == null ? null : Math.min(spread, goalKcal + MAKEUP_CAP_KCAL),
    from: monday,
    to: sunday,
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
