import { describe, expect, it } from 'vitest'
import type { Profile } from './types'
import {
  ACTIVITY,
  bmr,
  defaultSplit,
  goalPlan,
  macroTargets,
  maintenance,
  projectedWeightKg,
} from './nutrition'

const baseProfile = (overrides: Partial<Profile> = {}): Profile => ({
  sex: 'male',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
  targetWeightKg: 80,
  weeks: 10,
  proteinPerKg: 1.8,
  fatPct: 30,
  units: 'metric',
  ...overrides,
})

describe('Mifflin-St Jeor', () => {
  it('computes male BMR', () => {
    expect(bmr({ sex: 'male', age: 30, heightCm: 180, weightKg: 80 })).toBeCloseTo(1780, 5)
  })

  it('computes female BMR', () => {
    expect(bmr({ sex: 'female', age: 25, heightCm: 165, weightKg: 60 })).toBeCloseTo(1345.25, 5)
  })

  it('uses the midpoint correction when sex is undisclosed', () => {
    // Shared base for this body: 10*80 + 6.25*180 - 5*30 = 1775
    const v = bmr({ sex: 'undisclosed', age: 30, heightCm: 180, weightKg: 80 })
    expect(v).toBe(1775 - 78)
  })

  it('applies the activity multiplier', () => {
    expect(maintenance(baseProfile())).toBe(2759)
    expect(maintenance(baseProfile({ activity: 'sedentary' }))).toBe(2136)
    expect(ACTIVITY.very_active.factor).toBe(1.9)
  })
})

describe('goal planning', () => {
  it('maintains when target equals current weight', () => {
    const plan = goalPlan(baseProfile())
    expect(plan.target).toBe(2759)
    expect(plan.weeklyRateKg).toBe(0)
    expect(plan.clamped).toBe(false)
  })

  it('cuts with the requested pace', () => {
    const plan = goalPlan(baseProfile({ goal: 'cut', targetWeightKg: 75, weeks: 10 }))
    expect(plan.weeklyRateKg).toBeCloseTo(-0.5, 6)
    expect(plan.dailyDeltaKcal).toBe(-550)
    expect(plan.target).toBe(2209)
  })

  it('bulks with the requested pace', () => {
    const profile = baseProfile({ weightKg: 70, targetWeightKg: 74, weeks: 12, goal: 'bulk' })
    const plan = goalPlan(profile)
    expect(plan.weeklyRateKg).toBeCloseTo(4 / 12, 6)
    expect(plan.target).toBe(plan.maintenance + Math.round((4 / 12) * 7700 / 7))
  })

  it('never recommends below the safety floor', () => {
    const plan = goalPlan(
      baseProfile({ sex: 'female', weightKg: 55, targetWeightKg: 45, weeks: 4, activity: 'light' }),
    )
    expect(plan.target).toBe(1200)
    expect(plan.clamped).toBe(true)
    expect(plan.warning).toBeTruthy()
  })

  it('caps aggressive surpluses', () => {
    const plan = goalPlan(
      baseProfile({ weightKg: 60, targetWeightKg: 75, weeks: 4, goal: 'bulk' }),
    )
    expect(plan.target).toBe(plan.maintenance + 1000)
    expect(plan.clamped).toBe(true)
  })

  it('projects weight over time', () => {
    expect(projectedWeightKg(80, -550, 70)).toBeCloseTo(75, 5)
  })
})

describe('macro targets', () => {
  it('splits calories back into the same total', () => {
    const profile = baseProfile({ goal: 'cut', targetWeightKg: 75, proteinPerKg: 2.2, fatPct: 25 })
    const plan = goalPlan(profile)
    const t = macroTargets(profile, plan.target)
    expect(t.protein).toBe(165)
    const kcal = t.protein * 4 + t.carbs * 4 + t.fat * 9
    expect(Math.abs(kcal - plan.target)).toBeLessThanOrEqual(10)
  })

  it('uses current weight as reference when maintaining', () => {
    const t = macroTargets(baseProfile({ proteinPerKg: 1.8 }), 2759)
    expect(t.protein).toBe(144)
  })

  it('never returns negative carbs', () => {
    const t = macroTargets(baseProfile({ fatPct: 90 }), 1500)
    expect(t.carbs).toBeGreaterThanOrEqual(0)
  })

  it('defaults to higher protein while cutting', () => {
    expect(defaultSplit('cut').proteinPerKg).toBeGreaterThan(defaultSplit('bulk').proteinPerKg)
  })
})
