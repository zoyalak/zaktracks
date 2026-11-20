/**
 * Fuel: the day's calorie goal, built from the body, yesterday's movement and
 * a chosen deficit.
 *
 *   goal = BMR × 1.2 + steps + workouts - deficit
 *
 * Everything here is pure: the screen saves the plan and the daily activity,
 * and these functions turn them into the numbers (and the receipt) shown.
 */

import { bmr } from './nutrition'
import type { FuelDay, FuelPlan, FuelWorkout, Macro, Sex } from './types'

/** Fixed multiplier on BMR - no activity level is picked by the user. */
export const FUEL_BASE_FACTOR = 1.2

/** Every step counts: about 350 kcal per 10,000 steps at 70 kg. */
export const KCAL_PER_STEP_PER_KG = 0.0005

/** Hard ceiling on a daily deficit, whatever the body size. */
export const MAX_DEFICIT_KCAL = 1000

/** ...and a sensible ceiling relative to the base goal (30%). */
export const MAX_DEFICIT_SHARE = 0.3

/** The lowest daily intake the app will ever hand out. */
export const fuelFloorKcal = (sex: Sex): number =>
  sex === 'male' ? 1500 : sex === 'female' ? 1200 : 1350

/** Resting burn at the fixed 1.2 multiplier. */
export function fuelBaseKcal(plan: FuelPlan): number {
  return Math.round(bmr(plan) * FUEL_BASE_FACTOR)
}

export function fuelStepsKcal(plan: FuelPlan, steps: number): number {
  const n = Math.max(0, Math.round(steps || 0))
  return Math.round(n * KCAL_PER_STEP_PER_KG * plan.weightKg)
}

/** The largest deficit this body can safely carry. */
export function fuelDeficitLimit(plan: FuelPlan): number {
  return Math.max(0, Math.min(MAX_DEFICIT_KCAL, Math.round(fuelBaseKcal(plan) * MAX_DEFICIT_SHARE)))
}

export interface FuelReceipt {
  baseKcal: number
  steps: number
  stepsKcal: number
  /** The workouts that count, with the calories used for each. */
  workouts: FuelWorkout[]
  workoutsKcal: number
  burnedKcal: number
  /** What the user asked for. */
  requestedDeficit: number
  /** What was actually taken off (less when the floor got in the way). */
  deficitKcal: number
  deficitLimit: number
  /** True when the requested deficit was cut down to the safe limit. */
  deficitClamped: boolean
  floorKcal: number
  /** True when the floor, not the deficit, decided the final goal. */
  floorApplied: boolean
  goalKcal: number
}

/** Itemise one day's goal from the plan and that day's activity. */
export function fuelReceipt(plan: FuelPlan, day?: FuelDay | null): FuelReceipt {
  const baseKcal = fuelBaseKcal(plan)
  const steps = Math.max(0, Math.round(day?.steps ?? 0))
  const stepsKcal = fuelStepsKcal(plan, steps)
  const workouts = (day?.workouts ?? []).filter((w) => Number.isFinite(w.kcal) && w.kcal > 0)
  const workoutsKcal = Math.round(workouts.reduce((sum, w) => sum + w.kcal, 0))
  const burnedKcal = stepsKcal + workoutsKcal

  const deficitLimit = fuelDeficitLimit(plan)
  const requestedDeficit = Math.round(plan.deficitKcal || 0)
  const applied = Math.min(Math.max(0, requestedDeficit), deficitLimit)
  const floorKcal = fuelFloorKcal(plan.sex)

  const raw = baseKcal + burnedKcal - applied
  const goalKcal = Math.max(floorKcal, Math.round(raw))
  // The floor can eat into the deficit: report what actually came off.
  const deficitKcal = Math.max(0, baseKcal + burnedKcal - goalKcal)

  return {
    baseKcal,
    steps,
    stepsKcal,
    workouts,
    workoutsKcal,
    burnedKcal,
    requestedDeficit,
    deficitKcal,
    deficitLimit,
    deficitClamped: requestedDeficit > deficitLimit,
    floorKcal,
    floorApplied: raw < floorKcal,
    goalKcal,
  }
}

export interface FuelMacros {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

/** Split a calorie goal into protein / carbs / fat grams that sum back to it. */
export function fuelMacros(plan: FuelPlan, goalKcal: number): Macro {
  const kcal = Math.max(0, Math.round(goalKcal))
  // 1.8 g of protein per kg holds muscle on a deficit; fat takes 28% of the
  // goal and carbs fill the rest.
  let protein = Math.round(1.8 * plan.weightKg)
  protein = Math.max(40, Math.min(protein, Math.round((kcal * 0.45) / 4)))
  let fat = Math.round((kcal * 0.28) / 9)
  let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4)
  if (carbs < 0) {
    fat = Math.max(20, Math.round((kcal - protein * 4) / 9))
    carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  }
  return { kcal, protein, carbs, fat }
}

/** The goal a given day's food intake is measured against. */
export interface FuelGoal {
  goalKcal: number
  macro: Macro
}

/**
 * The Fuel goal for one date, or null when Fuel setup hasn't been done - the
 * rest of the app then keeps using the profile's own plan.
 */
export function fuelGoalFor(
  plan: FuelPlan | null | undefined,
  days: FuelDay[] | undefined,
  date: string,
): FuelGoal | null {
  if (!plan) return null
  const receipt = fuelReceipt(plan, days?.find((d) => d.date === date))
  return { goalKcal: receipt.goalKcal, macro: fuelMacros(plan, receipt.goalKcal) }
}
