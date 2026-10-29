import type { Food } from './types'

/**
 * Built-in food table. Values are per 100 g (or per serving when `per` is
 * 'serving') and follow USDA / public label data, rounded for sanity.
 * The AI can estimate anything that is missing — this table keeps the app
 * useful (and fast) with no network at all.
 */
type Row = [
  id: string,
  name: string,
  category: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  per?: 'serving',
  servingLabel?: string,
]

const ROWS: Row[] = [
  // Protein
  ['chicken_breast', 'Chicken breast, grilled', 'Protein', 165, 31, 0, 3.6],
  ['chicken_thigh', 'Chicken thigh, cooked', 'Protein', 209, 26, 0, 10.9],
  ['chicken_wing', 'Chicken wing, fried', 'Protein', 320, 26, 0, 24],
  ['ground_beef', 'Ground beef, cooked', 'Protein', 250, 26, 0, 15],
  ['steak', 'Sirloin steak, cooked', 'Protein', 217, 26, 0, 12],
  ['pork_chop', 'Pork chop, cooked', 'Protein', 231, 25, 0, 14],
  ['turkey_mince', 'Turkey mince, cooked', 'Protein', 189, 29, 0, 7],
  ['salmon', 'Salmon fillet, cooked', 'Protein', 208, 20, 0, 13],
  ['tuna_can', 'Tuna, canned in water', 'Protein', 116, 26, 0, 0.8],
  ['shrimp', 'Shrimp, cooked', 'Protein', 99, 24, 0.2, 0.3],
  ['cod', 'Cod fillet, cooked', 'Protein', 105, 23, 0, 0.9],
  ['egg', 'Whole egg', 'Protein', 143, 12.6, 0.7, 9.5],
  ['egg_white', 'Egg white', 'Protein', 52, 11, 0.7, 0.2],
  ['whey', 'Whey protein powder', 'Protein', 400, 80, 7, 6],
  ['tofu', 'Firm tofu', 'Protein', 144, 17, 3, 9],
  ['tempeh', 'Tempeh', 'Protein', 192, 20, 8, 11],
  ['lentils', 'Lentils, cooked', 'Protein', 116, 9, 20, 0.4],
  ['chickpeas', 'Chickpeas, cooked', 'Protein', 164, 8.9, 27, 2.6],
  ['black_beans', 'Black beans, cooked', 'Protein', 132, 8.9, 24, 0.5],

  // Carbs & grains
  ['rice_white', 'White rice, cooked', 'Carbs', 130, 2.7, 28, 0.3],
  ['rice_brown', 'Brown rice, cooked', 'Carbs', 123, 2.7, 26, 1],
  ['oats', 'Oats, dry', 'Carbs', 389, 17, 66, 7],
  ['pasta', 'Pasta, cooked', 'Carbs', 131, 5, 25, 1.1],
  ['quinoa', 'Quinoa, cooked', 'Carbs', 120, 4.4, 21, 1.9],
  ['bread_white', 'White bread', 'Carbs', 265, 9, 49, 3.2],
  ['bread_whole', 'Wholemeal bread', 'Carbs', 247, 13, 41, 3.4],
  ['bagel', 'Bagel', 'Carbs', 250, 10, 49, 1.7],
  ['tortilla', 'Flour tortilla', 'Carbs', 306, 8, 51, 7.5],
  ['sweet_potato', 'Sweet potato, baked', 'Carbs', 90, 2, 21, 0.1],
  ['potato', 'Potato, boiled', 'Carbs', 87, 2, 20, 0.1],
  ['fries', 'French fries', 'Carbs', 312, 3.4, 41, 15],
  ['cereal', 'Breakfast cereal, flakes', 'Carbs', 357, 7.5, 84, 0.9],
  ['granola', 'Granola', 'Carbs', 471, 10, 64, 20],
  ['croissant', 'Croissant', 'Carbs', 406, 8.2, 46, 21],
  ['pancake', 'Pancakes', 'Carbs', 227, 6.4, 28, 10],
  ['waffle', 'Waffle', 'Carbs', 291, 6.4, 33, 14],
  ['pizza', 'Pizza, cheese', 'Carbs', 266, 11, 33, 10],
  ['sushi', 'Sushi roll', 'Carbs', 145, 6, 30, 0.7],
  ['burrito', 'Chicken burrito', 'Carbs', 206, 9, 25, 8],
  ['pad_thai', 'Pad Thai', 'Carbs', 170, 8, 25, 4.5],
  ['fried_rice', 'Fried rice', 'Carbs', 180, 5, 28, 5.5],
  ['curry', 'Chicken curry', 'Carbs', 150, 9, 8, 9],
  ['burger', 'Cheeseburger', 'Carbs', 254, 13, 21, 13],
  ['bolognese', 'Bolognese sauce', 'Carbs', 130, 10, 6, 7],
  ['falafel', 'Falafel', 'Carbs', 333, 13, 32, 18],

  // Dairy
  ['milk_whole', 'Whole milk', 'Dairy', 61, 3.2, 4.8, 3.3],
  ['milk_skim', 'Skimmed milk', 'Dairy', 34, 3.4, 5, 0.1],
  ['greek_yogurt_0', 'Greek yogurt, 0% fat', 'Dairy', 59, 10, 3.6, 0.4],
  ['greek_yogurt_5', 'Greek yogurt, 5% fat', 'Dairy', 97, 9, 4, 5],
  ['cottage', 'Cottage cheese', 'Dairy', 98, 11, 3.4, 4.3],
  ['cheddar', 'Cheddar cheese', 'Dairy', 403, 25, 1.3, 33],
  ['mozzarella', 'Mozzarella', 'Dairy', 280, 28, 3.1, 17],
  ['parmesan', 'Parmesan', 'Dairy', 392, 36, 4.1, 25],
  ['kefir', 'Kefir', 'Dairy', 41, 3, 4.7, 1],
  ['ice_cream', 'Vanilla ice cream', 'Dairy', 207, 3.5, 24, 11],
  ['butter', 'Butter', 'Dairy', 717, 0.9, 0.1, 81],

  // Fruit & veg
  ['banana', 'Banana', 'Fruit & veg', 89, 1.1, 23, 0.3],
  ['apple', 'Apple', 'Fruit & veg', 52, 0.3, 14, 0.2],
  ['orange', 'Orange', 'Fruit & veg', 47, 0.9, 12, 0.1],
  ['strawberries', 'Strawberries', 'Fruit & veg', 32, 0.7, 7.7, 0.3],
  ['blueberries', 'Blueberries', 'Fruit & veg', 57, 0.7, 14, 0.3],
  ['grapes', 'Grapes', 'Fruit & veg', 69, 0.7, 18, 0.2],
  ['mango', 'Mango', 'Fruit & veg', 60, 0.8, 15, 0.4],
  ['pineapple', 'Pineapple', 'Fruit & veg', 50, 0.9, 13, 0.1],
  ['avocado', 'Avocado', 'Fruit & veg', 160, 2, 9, 15],
  ['broccoli', 'Broccoli, cooked', 'Fruit & veg', 35, 2.4, 7, 0.4],
  ['spinach', 'Spinach, raw', 'Fruit & veg', 23, 2.9, 3.6, 0.4],
  ['salad', 'Mixed salad leaves', 'Fruit & veg', 15, 1.4, 2.9, 0.2],
  ['carrot', 'Carrot', 'Fruit & veg', 41, 0.9, 10, 0.2],
  ['tomato', 'Tomato', 'Fruit & veg', 18, 0.9, 3.9, 0.2],
  ['cucumber', 'Cucumber', 'Fruit & veg', 15, 0.7, 3.6, 0.1],
  ['corn', 'Sweetcorn', 'Fruit & veg', 86, 3.2, 19, 1.4],
  ['mushrooms', 'Mushrooms', 'Fruit & veg', 22, 3.1, 3.3, 0.3],

  // Fats, nuts & spreads
  ['almonds', 'Almonds', 'Fats & nuts', 579, 21, 22, 50],
  ['walnuts', 'Walnuts', 'Fats & nuts', 654, 15, 14, 65],
  ['cashews', 'Cashews', 'Fats & nuts', 553, 18, 30, 44],
  ['peanuts', 'Peanuts', 'Fats & nuts', 567, 26, 16, 49],
  ['peanut_butter', 'Peanut butter', 'Fats & nuts', 588, 25, 20, 50],
  ['olive_oil', 'Olive oil', 'Fats & nuts', 884, 0, 0, 100],
  ['coconut_oil', 'Coconut oil', 'Fats & nuts', 862, 0, 0, 100],
  ['hummus', 'Hummus', 'Fats & nuts', 166, 8, 14, 10],
  ['dark_chocolate', 'Dark chocolate, 70%', 'Fats & nuts', 598, 8, 46, 43],
  ['milk_chocolate', 'Milk chocolate', 'Fats & nuts', 535, 7.6, 59, 30],

  // Drinks & serving-based staples
  ['protein_shake', 'Protein shake (whey + water)', 'Drinks', 150, 30, 3, 2, 'serving', '1 shake (350 ml)'],
  ['latte', 'Latte (whole milk)', 'Drinks', 47, 2.4, 3.6, 2.5, 'serving', '1 cup (350 ml)'],
  ['coca_cola', 'Cola', 'Drinks', 42, 0, 10.6, 0, 'serving', '1 can (330 ml)'],
  ['orange_juice', 'Orange juice', 'Drinks', 45, 0.7, 10, 0.2, 'serving', '1 glass (250 ml)'],
  ['beer', 'Beer', 'Drinks', 43, 0.5, 3.6, 0, 'serving', '1 bottle (330 ml)'],
  ['red_wine', 'Red wine', 'Drinks', 85, 0.1, 2.6, 0, 'serving', '1 glass (150 ml)'],
  ['coffee_black', 'Coffee, black', 'Drinks', 1, 0.1, 0, 0],
  ['almond_milk', 'Almond milk, unsweetened', 'Drinks', 13, 0.4, 0.3, 1.1, 'serving', '1 glass (250 ml)'],
  ['protein_bar', 'Protein bar', 'Snacks', 400, 33, 40, 12, 'serving', '1 bar (60 g)'],
]

export const BUILTIN_FOODS: Food[] = ROWS.map(
  ([id, name, category, kcal, protein, carbs, fat, per, servingLabel]) => ({
    id,
    name,
    category,
    kcal,
    protein,
    carbs,
    fat,
    per: per ?? '100g',
    servingLabel,
    gramsPerServing: per === 'serving' ? parseGrams(servingLabel) : undefined,
    source: 'builtin' as const,
  }),
)

/** Pull "(350 ml)" style numbers out of a serving label. */
function parseGrams(label?: string): number | undefined {
  if (!label) return undefined
  const m = label.match(/\((\d+(?:\.\d+)?)\s*(?:g|ml)\)/i)
  return m ? parseFloat(m[1]) : undefined
}

/** Fuzzy-ish relevance score for the food search box. */
export function scoreFood(food: Food, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const name = food.name.toLowerCase()
  const tokens = q.split(/\s+/).filter(Boolean)
  let score = 0
  for (const t of tokens) {
    if (name === t) score += 100
    else if (name.startsWith(t)) score += 60
    else if (name.includes(` ${t}`)) score += 40
    else if (name.includes(t)) score += 25
    else if ((food.brand ?? '').toLowerCase().includes(t)) score += 30
    else return -1
  }
  return score
}

/** Built-in + custom foods ranked for a query. */
export function searchFoods(query: string, custom: Food[] = [], builtin = BUILTIN_FOODS): Food[] {
  const all = [...custom, ...builtin]
  if (!query.trim()) return all.slice(0, 40)
  return all
    .map((f) => ({ f, s: scoreFood(f, query) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name))
    .slice(0, 60)
    .map((x) => x.f)
}

export const foodsByCategory = (foods: Food[]): { category: string; items: Food[] }[] => {
  const map = new Map<string, Food[]>()
  for (const f of foods) {
    const key = f.category ?? (f.source === 'builtin' ? 'Other' : 'My foods')
    const list = map.get(key) ?? []
    list.push(f)
    map.set(key, list)
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }))
}
