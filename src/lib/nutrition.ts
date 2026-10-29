import type { ActivityKey, Macro, Profile } from './types'
import { emptyMacro } from './types'

/** Energy density of body tissue. 1 kg of tissue ≈ 7700 kcal. */
export const KCAL_PER_KG = 7700

export const ACTIVITY: Record<ActivityKey, { label: string; factor: number; hint: string }> = {
  sedentary: { label: 'Sedentary', factor: 1.2, hint: 'Desk job, little or no exercise' },
  light: { label: 'Lightly active', factor: 1.375, hint: 'Exercise 1–3 days a week' },
  moderate: { label: 'Moderately active', factor: 1.55, hint: 'Exercise 3–5 days a week' },
  active: { label: 'Very active', factor: 1.725, hint: 'Hard training 6–7 days a week' },
  very_active: { label: 'Athlete', factor: 1.9, hint: 'Twice-daily training or a physical job' },
}

export interface BmrInput {
  sex: Profile['sex']
  age: number
  heightCm: number
  weightKg: number
}

/** Mifflin-St Jeor resting metabolic rate. */
export function bmr(input: BmrInput): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age
  if (input.sex === 'male') return base + 5
  if (input.sex === 'female') return base - 161
  // Midpoint of the two corrections when the user would rather not say.
  return base - 78
}

export function maintenance(profile: Profile): number {
  return Math.round(bmr(profile) * ACTIVITY[profile.activity].factor)
}

export interface GoalPlan {
  /** Calories needed to hold current weight. */
  maintenance: number
  /** Daily calorie target for the goal. */
  target: number
  /** Expected weight change per week, kg (negative while cutting). */
  weeklyRateKg: number
  /** Daily kcal surplus (+) or deficit (-). */
  dailyDeltaKcal: number
  targetWeightKg: number
  weeks: number
  clamped: boolean
  warning?: string
}

/** Lowest daily intake we will ever recommend. */
export function floorCalories(profile: Profile): number {
  return profile.sex === 'female' ? 1200 : 1500
}

const MAX_SURPLUS = 1000

export function goalPlan(profile: Profile): GoalPlan {
  const maint = maintenance(profile)
  const weeks = Math.max(1, profile.weeks || 1)
  const weeklyRateKg = (profile.targetWeightKg - profile.weightKg) / weeks
  const dailyDeltaKcal = (weeklyRateKg * KCAL_PER_KG) / 7
  let target = Math.round(maint + dailyDeltaKcal)
  let clamped = false
  let warning: string | undefined

  const floor = floorCalories(profile)
  if (target < floor) {
    target = floor
    clamped = true
    warning = `For safety this plan never goes below ${floor} kcal/day. To keep losing at the pace you picked, add more cardio or stretch the deadline.`
  }
  if (dailyDeltaKcal > MAX_SURPLUS) {
    target = Math.round(maint + MAX_SURPLUS)
    clamped = true
    warning = `Muscle-building meals work best with a surplus of about 300–500 kcal/day. This plan is capped at +${MAX_SURPLUS} kcal/day; the rest of the time is better spent lean.`
  }
  // Rate sanity check: more than ~1% of body weight per week is aggressive.
  if (weeklyRateKg < -0.01 * profile.weightKg || weeklyRateKg > 0.0125 * profile.weightKg) {
    warning =
      (warning ? warning + ' ' : '') +
      'A change faster than ~1% of body weight per week is aggressive — expect more hunger and muscle loss risk.'
  }

  return {
    maintenance: maint,
    target,
    weeklyRateKg,
    dailyDeltaKcal: Math.round(dailyDeltaKcal),
    targetWeightKg: profile.targetWeightKg,
    weeks,
    clamped,
    warning,
  }
}

export interface MacroTargets extends Macro {
  protein: number
  carbs: number
  fat: number
}

/** Split a calorie target into protein / carbs / fat grams that sum back to it. */
export function macroTargets(profile: Profile, goalKcal: number): MacroTargets {
  const referenceWeight = profile.goal === 'maintain' ? profile.weightKg : profile.targetWeightKg
  let protein = Math.round(profile.proteinPerKg * referenceWeight)
  let fat = Math.round((goalKcal * profile.fatPct) / 100 / 9)
  let carbs = Math.round((goalKcal - protein * 4 - fat * 9) / 4)

  // Guard the degenerate cases (tiny calorie targets, extreme splits).
  if (carbs < 0) {
    fat = Math.max(20, Math.round((goalKcal - protein * 4 - 80) / 9))
    carbs = Math.round((goalKcal - protein * 4 - fat * 9) / 4)
  }
  if (carbs < 0) {
    protein = Math.max(60, Math.round((goalKcal - fat * 9 - 60) / 4))
    carbs = Math.max(0, Math.round((goalKcal - protein * 4 - fat * 9) / 4))
  }

  return { kcal: Math.round(goalKcal), protein, carbs, fat }
}

/** Default protein per kg and fat share for a goal type. */
export function defaultSplit(goal: Profile['goal']): { proteinPerKg: number; fatPct: number } {
  if (goal === 'cut') return { proteinPerKg: 2.2, fatPct: 25 }
  if (goal === 'bulk') return { proteinPerKg: 1.8, fatPct: 25 }
  return { proteinPerKg: 1.8, fatPct: 30 }
}

/** Weight change implied by a constant daily deficit/surplus over N days. */
export function projectedWeightKg(currentKg: number, dailyDeltaKcal: number, days: number): number {
  return currentKg + (dailyDeltaKcal * days) / KCAL_PER_KG
}

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Coerce possibly-messy AI or user input into a clean macro record. */
export function coerceMacro(v: unknown): Macro {
  const n = (x: unknown): number => {
    const num = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN
    return Number.isFinite(num) && num >= 0 ? num : 0
  }
  if (!v || typeof v !== 'object') return emptyMacro()
  const o = v as Record<string, unknown>
  return { kcal: n(o.kcal), protein: n(o.protein), carbs: n(o.carbs), fat: n(o.fat) }
}
