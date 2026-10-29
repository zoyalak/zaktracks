import type { Food, LogItem } from './types'
import { scaleExtras } from './types'
import { BUILTIN_FOODS, scoreFood } from './foods'

/** Rough default portions (grams) when the user doesn't specify one. */
const DEFAULT_GRAMS: Record<string, number> = {
  Protein: 150,
  Carbs: 200,
  Dairy: 150,
  'Fruit & veg': 120,
  'Fats & nuts': 20,
  Drinks: 250,
  Snacks: 60,
  Other: 120,
}

const FALLBACK = 120

const scale = (food: Food, grams: number): LogItem => {
  const factor = food.per === 'serving' ? 1 : grams / 100
  return {
    name: food.per === 'serving' ? `${food.name}${food.servingLabel ? ` (${food.servingLabel})` : ''}` : food.name,
    grams: food.per === 'serving' ? (food.gramsPerServing ?? null) : grams,
    kcal: round1(food.kcal * factor),
    protein: round1(food.protein * factor),
    carbs: round1(food.carbs * factor),
    fat: round1(food.fat * factor),
    foodId: food.id,
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/** "2 eggs" → { qty: 2, rest: "eggs" } */
const parseQuantity = (fragment: string): { qty: number; rest: string } => {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(x|×)?\s+(.*)$/.exec(fragment)
  if (m) {
    const qty = parseFloat(m[1].replace(',', '.'))
    if (Number.isFinite(qty) && qty > 0 && qty <= 20) return { qty, rest: m[3] }
  }
  return { qty: 1, rest: fragment }
}

const FRACTIONS: Record<string, number> = {
  half: 0.5,
  quarter: 0.25,
  double: 2,
}

const parseFraction = (fragment: string): { qty: number; rest: string } => {
  const m = /^\s*(half|quarter|double)\s+of\s+(.*)$/i.exec(fragment)
  if (m) return { qty: FRACTIONS[m[1].toLowerCase()], rest: m[2] }
  return parseQuantity(fragment)
}

/**
 * Turn a free-text meal description into candidate items using the built-in
 * food table. Fragments we cannot recognise are returned so the UI can ask the
 * user to fill them in.
 */
export function estimateFromText(
  text: string,
  custom: Food[] = [],
  builtin: Food[] = BUILTIN_FOODS,
): { items: LogItem[]; unmatched: string[] } {
  const fragments = text
    .split(/[,;+\n]|\band\b|\bw\/\b|\bwith\b|\+&\s*/i)
    .map((f) => f.replace(/^[•\-\s]+/, '').trim())
    .filter((f) => f.length > 1)

  const pool = [...custom, ...builtin]
  const items: LogItem[] = []
  const unmatched: string[] = []
  const used = new Set<string>()

  for (const fragment of fragments) {
    const { qty, rest } = parseFraction(fragment)
    let best: Food | null = null
    let bestScore = 0
    for (const food of pool) {
      const s = scoreFood(food, rest)
      if (s > bestScore) {
        bestScore = s
        best = food
      }
    }
    if (!best || bestScore < 25) {
      unmatched.push(fragment)
      continue
    }
    const key = `${best.id}`
    if (used.has(key)) continue
    used.add(key)
    const base = DEFAULT_GRAMS[best.category ?? 'Other'] ?? FALLBACK
    items.push(scale(best, Math.round(base * qty)))
  }

  return { items, unmatched }
}

/**
 * Match one ingredient against the food table and scale it to `grams`.
 * This is the fallback when the AI can't answer: returns null when nothing
 * matches well enough to trust.
 */
export function matchIngredient(
  name: string,
  grams: number,
  custom: Food[] = [],
  builtin: Food[] = BUILTIN_FOODS,
): LogItem | null {
  let best: Food | null = null
  let bestScore = 0
  for (const food of [...custom, ...builtin]) {
    // Saved recipes are already made of ingredients — never match one of
    // those when the user is naming a plain ingredient.
    if (food.source === 'recipe') continue
    const s = scoreFood(food, name)
    if (s > bestScore) {
      bestScore = s
      best = food
    }
  }
  if (!best || bestScore < 25) return null
  const factor = best.per === 'serving' ? grams / (best.gramsPerServing || 100) : grams / 100
  return {
    name,
    grams,
    kcal: Math.round(best.kcal * factor),
    protein: round1(best.protein * factor),
    carbs: round1(best.carbs * factor),
    fat: round1(best.fat * factor),
    extras: scaleExtras(best.extras, factor),
    foodId: best.id,
  }
}

/** Sum items into a label like "Chicken and rice". */
export const itemsToName = (items: LogItem[]): string => {
  if (!items.length) return 'Meal'
  const names = items.slice(0, 2).map((i) => i.name.split(',')[0])
  const unique = names.filter((n, i) => names.indexOf(n) === i)
  return unique.join(' & ').slice(0, 48) || 'Meal'
}
