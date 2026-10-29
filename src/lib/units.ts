import type { UnitSystem } from './types'

export const KG_TO_LB = 2.2046226218

export const kgToLb = (kg: number): number => kg * KG_TO_LB
export const lbToKg = (lb: number): number => lb / KG_TO_LB

export const cmToIn = (cm: number): number => cm / 2.54
export const inToCm = (inch: number): number => inch * 2.54

export function cmToFtIn(cm: number): { ft: number; in: number } {
  const totalIn = cmToIn(cm)
  const ft = Math.floor(totalIn / 12)
  const inch = Math.round(totalIn - ft * 12)
  return inch === 12 ? { ft: ft + 1, in: 0 } : { ft, in: inch }
}

export function ftInToCm(ft: number, inch: number): number {
  return inToCm(ft * 12 + inch)
}

export const weightLabel = (units: UnitSystem): string => (units === 'metric' ? 'kg' : 'lb')
export const heightLabel = (units: UnitSystem): string => (units === 'metric' ? 'cm' : 'ft in')

/** Display a body weight in the user's unit system. */
export const displayWeight = (kg: number, units: UnitSystem): number =>
  units === 'metric' ? Math.round(kg * 10) / 10 : Math.round(kgToLb(kg) * 10) / 10

/** Convert a value typed in the user's unit system into kg. */
export const toKg = (value: number, units: UnitSystem): number =>
  units === 'metric' ? value : lbToKg(value)

export const fromKg = (kg: number, units: UnitSystem): number =>
  units === 'metric' ? kg : kgToLb(kg)

export const formatNumber = (n: number, digits = 0): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
