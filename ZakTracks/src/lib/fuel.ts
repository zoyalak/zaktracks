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
import { shiftKey } from './date'
import type { FuelDay, FuelPlan, FuelWorkout, Macro, Sex } from './types'

/** Fixed multiplier on BMR - no activity level is picked by the user. */
export const FUEL_BASE_FACTOR = 1.2

/** Every step counts: about 350 kcal per 10,000 steps at 70 kg. */
export const KCAL_PER_STEP_PER_KG = 0.0005

/** Hard ceiling on a daily deficit, whatever the body size. */
export const MAX_DEFICIT_KCAL = 1000

/** ...and a sensible ceiling relative to the base goal (30%). */
export const MAX_DEFICIT_SHARE = 0.3

/** Share of an uneaten day that rolls into the next day's goal. */
export const CARRY_SHARE = 0.5

/**
 * A day has to be more than this far under target before anything carries
 * over; landing within 100 kcal of the goal is close enough to count as done.
 */
export const CARRY_THRESHOLD_KCAL = 100

/** Share of an overage that is taken off the next day's goal. */
export const OVER_SHARE = 0.75

/** A day has to go at least this far over target before anything is clawed back. */
export const OVER_THRESHOLD_KCAL = 300

/** How many days back the chain of carries is followed. */
const CARRY_LOOKBACK_DAYS = 60

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
  /** Calories carried in from the day before. */
  carryKcal: number
  deficitLimit: number
  /** True when the requested deficit was cut down to the safe limit. */
  deficitClamped: boolean
  floorKcal: number
  /** True when the floor, not the deficit, decided the final goal. */
  floorApplied: boolean
  goalKcal: number
}

/**
 * Itemise one day's goal from the plan, that day's activity and whatever the
 * day before left on the table.
 */
export function fuelReceipt(plan: FuelPlan, day?: FuelDay | null, carryKcal = 0): FuelReceipt {
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

  // Negative when the day before went over: it takes calories off this goal.
  const carry = Math.round(carryKcal)
  const raw = baseKcal + burnedKcal + carry - applied
  const goalKcal = Math.max(floorKcal, Math.round(raw))
  // The floor can eat into the deficit: report what actually came off.
  const deficitKcal = Math.max(0, baseKcal + burnedKcal + carry - goalKcal)

  return {
    baseKcal,
    steps,
    stepsKcal,
    workouts,
    workoutsKcal,
    burnedKcal,
    requestedDeficit,
    deficitKcal,
    carryKcal: carry,
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

/** What one day hands to the next: an uneaten day tops up, an over day cuts. */
export interface FuelCarry {
  /** Change to this day's goal: + for a leftover, - for an overage penalty. */
  kcal: number
  /** The day the carry comes from. */
  from: string
  /** That day's goal, including whatever that day was handed itself. */
  goalKcal: number
  eatenKcal: number
  /** Goal minus eaten, never below zero. */
  shortfallKcal: number
  /** Eaten minus goal, never below zero. */
  overKcal: number
  /** The cut taken off this day for going over (a negative number). */
  penaltyKcal: number
  /** False when that day had no log at all - unknown, not a full shortfall. */
  logged: boolean
}

/**
 * Work out what one finished day hands over: 300 kcal or more over target and
 * 75% of the overage comes off the next day, otherwise anything more than 100
 * kcal left uneaten adds half of it on. A day within 100 kcal counts as done,
 * and a day with nothing logged hands nothing over: it is unknown, not a fast.
 */
function carryBetween(from: string, goalKcal: number, eatenKcal: number | null): FuelCarry {
  if (eatenKcal == null) {
    return {
      kcal: 0,
      from,
      goalKcal,
      eatenKcal: 0,
      shortfallKcal: 0,
      overKcal: 0,
      penaltyKcal: 0,
      logged: false,
    }
  }

  const diff = eatenKcal - goalKcal
  const overKcal = Math.max(0, diff)
  const shortfallKcal = Math.max(0, -diff)
  const penaltyKcal = overKcal >= OVER_THRESHOLD_KCAL ? -Math.round(overKcal * OVER_SHARE) : 0
  const leftoverKcal =
    penaltyKcal === 0 && shortfallKcal > CARRY_THRESHOLD_KCAL
      ? Math.round(shortfallKcal * CARRY_SHARE)
      : 0

  return {
    kcal: leftoverKcal + penaltyKcal,
    from,
    goalKcal,
    eatenKcal,
    shortfallKcal,
    overKcal,
    penaltyKcal,
    logged: true,
  }
}

/**
 * What the day before `date` hands over. The goal it is measured against is
 * that day's own goal with its own carry, so eating exactly to a topped-up
 * goal is neither under nor over.
 */
export function fuelCarryFor(
  plan: FuelPlan,
  days: FuelDay[] | undefined,
  date: string,
  eatenOn: (date: string) => number | null,
): FuelCarry {
  return resolveCarry(plan, days, date, eatenOn, new Map(), 0)
}

function resolveCarry(
  plan: FuelPlan,
  days: FuelDay[] | undefined,
  date: string,
  eatenOn: (date: string) => number | null,
  memo: Map<string, FuelCarry>,
  depth: number,
): FuelCarry {
  const cached = memo.get(date)
  if (cached) return cached

  const from = shiftKey(date, -1)
  const eatenKcal = eatenOn(from)
  const prevDay = days?.find((d) => d.date === from)

  // An unlogged day hands nothing over, so the chain stops there.
  const carry =
    eatenKcal == null
      ? carryBetween(from, fuelReceipt(plan, prevDay).goalKcal, null)
      : carryBetween(
          from,
          fuelReceipt(
            plan,
            prevDay,
            depth < CARRY_LOOKBACK_DAYS ? resolveCarry(plan, days, from, eatenOn, memo, depth + 1).kcal : 0,
          ).goalKcal,
          eatenKcal,
        )

  memo.set(date, carry)
  return carry
}

/** The goal a given day's food intake is measured against. */
export interface FuelGoal {
  goalKcal: number
  macro: Macro
}

export interface FuelBreakdown {
  receipt: FuelReceipt
  carry: FuelCarry
  macro: Macro
}

/** Everything one day's target is made of, or null when Fuel isn't set up. */
export function fuelBreakdown(
  plan: FuelPlan | null | undefined,
  days: FuelDay[] | undefined,
  date: string,
  eatenOn: (date: string) => number | null,
): FuelBreakdown | null {
  if (!plan) return null
  const carry = fuelCarryFor(plan, days, date, eatenOn)
  const receipt = fuelReceipt(plan, days?.find((d) => d.date === date), carry.kcal)
  return { receipt, carry, macro: fuelMacros(plan, receipt.goalKcal) }
}

/**
 * The Fuel goal for one date, or null when Fuel setup hasn't been done - the
 * rest of the app then keeps using the profile's own plan.
 */
export function fuelGoalFor(
  plan: FuelPlan | null | undefined,
  days: FuelDay[] | undefined,
  date: string,
  eatenOn: (date: string) => number | null,
): FuelGoal | null {
  const breakdown = fuelBreakdown(plan, days, date, eatenOn)
  return breakdown ? { goalKcal: breakdown.receipt.goalKcal, macro: breakdown.macro } : null
}
