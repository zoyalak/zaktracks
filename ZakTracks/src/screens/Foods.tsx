import { useMemo, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { BUILTIN_FOODS, foodsByCategory, searchFoods } from '../lib/foods'
import type { Food, LogItem } from '../lib/types'
import { itemsToGrams, scaleExtras, scaleItems } from '../lib/types'
import { makeId } from '../lib/date'
import { ApiError, analyzeLabel } from '../lib/api'
import { fileToDataUrl } from '../lib/photo'
import FoodEditor from '../components/FoodEditor'
import RecipeEditor from '../components/RecipeEditor'
import { Choice, Field, Loading, Notice, Sheet } from '../components/ui'

export default function Foods() {
  const { foods, profile, upsertFood, removeFood, upsertMeal } = useApp()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'mine' | string>('all')
  const [detail, setDetail] = useState<Food | null>(null)
  const [editor, setEditor] = useState<{ food: Food | null; scanned: boolean } | null>(null)
  const [chooser, setChooser] = useState(false)
  const [recipe, setRecipe] = useState<{ food: Food | null } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [grams, setGrams] = useState('100')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const all = useMemo(() => [...foods, ...BUILTIN_FOODS], [foods])

  const categories = useMemo(() => {
    const cats = [...new Set(all.map((f) => f.category ?? (f.source === 'builtin' ? 'Other' : 'My foods')))]
    return cats.sort()
  }, [all])

  const results = useMemo(() => {
    const base = query.trim()
      ? searchFoods(query, foods)
      : filter === 'mine'
        ? foods
        : filter === 'all'
          ? all
          : all.filter((f) => (f.category ?? (f.source === 'builtin' ? 'Other' : 'My foods')) === filter)
    return base
  }, [query, filter, foods, all])

  const scanLabel = async (file: File) => {
    setScanning(true)
    setScanError(null)
    try {
      const photo = await fileToDataUrl(file, 1280, 0.85)
      const parsed = await analyzeLabel(photo.dataUrl)
      const scanned: Food = {
        id: makeId(),
        name: parsed.name || 'Scanned food',
        brand: parsed.brand || undefined,
        per: parsed.per,
        servingLabel: parsed.servingLabel || undefined,
        gramsPerServing: parsed.gramsPerServing ?? undefined,
        kcal: parsed.kcal,
        protein: parsed.protein,
        carbs: parsed.carbs,
        fat: parsed.fat,
        extras: parsed.extras,
        source: 'label',
        createdAt: Date.now(),
      }
      setEditor({ food: scanned, scanned: true })
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.code === 'NO_API_KEY'
            ? 'Label scanning needs the OpenRouter API key on the server. You can still add the food manually — tap "New food".'
            : err.message
          : 'Could not read that label.'
      setScanError(message)
      setEditor({ food: null, scanned: false })
    } finally {
      setScanning(false)
    }
  }

  const saveFood = async (food: Food) => {
    setSaving(true)
    setSaveError(null)
    try {
      await upsertFood(food)
      setEditor(null)
      setRecipe(null)
    } catch (err) {
      console.error('Could not save food', err)
      setSaveError(
        'Could not save that food — your device storage refused the write. Your entries are still on screen; try saving again.',
      )
    } finally {
      setSaving(false)
    }
  }

  const openDetail = (f: Food) => {
    setDetail(f)
    // A recipe is logged by its batch size; everything else starts at 100 g.
    setGrams(
      f.source === 'recipe'
        ? String(f.gramsPerServing || itemsToGrams(f.ingredients ?? []) || 100)
        : '100',
    )
  }

  const addToToday = async (food: Food) => {
    if (!profile) return
    setSaveError(null)
    const g = parseFloat(grams)
    const now = new Date()
    let items: LogItem[]

    if (food.source === 'recipe' && food.ingredients?.length) {
      // Log the recipe as one row per ingredient, scaled to the amount being
      // added, so the day keeps the same breakdown the recipe was built with.
      const batch = food.gramsPerServing || itemsToGrams(food.ingredients)
      const target = Number.isFinite(g) && g > 0 ? g : batch
      items = scaleItems(food.ingredients, batch > 0 ? target / batch : 1)
    } else {
      const factor = food.per === 'serving' ? 1 : (Number.isFinite(g) && g > 0 ? g : 100) / 100
      items = [
        {
          name: food.name,
          grams: food.per === 'serving' ? (food.gramsPerServing ?? null) : Number.isFinite(g) ? g : 100,
          kcal: Math.round(food.kcal * factor),
          protein: Math.round(food.protein * factor * 10) / 10,
          carbs: Math.round(food.carbs * factor * 10) / 10,
          fat: Math.round(food.fat * factor * 10) / 10,
          extras: scaleExtras(food.extras, factor),
          foodId: food.id,
        },
      ]
    }

    await upsertMeal({
      id: makeId(),
      date: `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`,
      time: `${`${now.getHours()}`.padStart(2, '0')}:${`${now.getMinutes()}`.padStart(2, '0')}`,
      name: food.name,
      note: '',
      source: 'food',
      createdAt: Date.now(),
      items,
    })
    setDetail(null)
  }

  const grouped = filter === 'all' && !query.trim() ? foodsByCategory(results) : null

  return (
    <>
      <div className="topbar">
        <div>
          <div className="sub">{BUILTIN_FOODS.length + foods.length} foods</div>
          <h1>Food library</h1>
        </div>
        <button
          className="icon-btn"
          aria-label="Add to your food library"
          onClick={() => setChooser(true)}
        >
          +
        </button>
      </div>

      <div className="searchbar">
        <span className="icon" aria-hidden>
          🔍
        </span>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the built-in table and your foods"
        />
      </div>

      <div className="pill-tabs">
        <button className={`pill${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          All
        </button>
        <button className={`pill${filter === 'mine' ? ' active' : ''}`} onClick={() => setFilter('mine')}>
          My foods ({foods.length})
        </button>
        {categories.map((c) => (
          <button key={c} className={`pill${filter === c ? ' active' : ''}`} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Scan a nutrition label</h2>
          <span className="hint">highest accuracy</span>
        </div>
        {scanError && <Notice type="warn">{scanError}</Notice>}
        {scanning ? (
          <Loading label="Reading the label…" />
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 12 }}>
              Photograph the nutrition panel and the AI fills in the values. You can correct every
              number before it's saved.
            </p>
            <button className="btn primary" onClick={() => fileInput.current?.click()}>
              📷 Scan a label
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void scanLabel(f)
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>

      {grouped ? (
        grouped.map((group) => (
          <div key={group.category}>
            <div className="section-label">{group.category}</div>
            <div className="card">
          {group.items.map((f) => (
            <FoodRow key={f.id} food={f} onOpen={openDetail} />
          ))}
            </div>
          </div>
        ))
      ) : (
        <div className="card">
          {results.map((f) => (
            <FoodRow key={f.id} food={f} onOpen={openDetail} />
          ))}
          {!results.length && (
            <div className="empty">
              <span className="big" aria-hidden>
                🧐
              </span>
              No match. Add it as a new food and it becomes searchable forever.
            </div>
          )}
        </div>
      )}

      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ''}
        sub={
          detail?.source === 'recipe'
            ? 'Your recipe'
            : detail?.brand || (detail?.source === 'builtin' ? 'Built-in food' : 'Your food')
        }
      >
        {detail && (
          <>
            <div className="kv">
              <span className="k">Values are per</span>
              <span className="v">
                {detail.source === 'recipe'
                  ? `the whole recipe (${detail.ingredients?.length ?? 0} ingredients)`
                  : detail.per === 'serving'
                    ? detail.servingLabel ?? 'serving'
                    : '100 g'}
              </span>
            </div>
            <div className="kv">
              <span className="k">Calories</span>
              <span className="v num">{detail.kcal} kcal</span>
            </div>
            <div className="kv">
              <span className="k">Protein</span>
              <span className="v num">{detail.protein} g</span>
            </div>
            <div className="kv">
              <span className="k">Carbs</span>
              <span className="v num">{detail.carbs} g</span>
            </div>
            <div className="kv">
              <span className="k">Fat</span>
              <span className="v num">{detail.fat} g</span>
            </div>

            {detail.source === 'recipe' && detail.ingredients?.length ? (
              <>
                <div className="divider" />
                <div className="section-label">Ingredients</div>
                {detail.ingredients.map((ing, i) => (
                  <div className="list-item" key={`${ing.name}-${i}`}>
                    <span className="grow">
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{ing.name}</span>
                      <span className="tiny" style={{ display: 'block' }}>
                        {ing.grams != null ? `${ing.grams} g · ` : ''}
                        {Math.round(ing.protein)}P · {Math.round(ing.carbs)}C · {Math.round(ing.fat)}F
                      </span>
                    </span>
                    <span className="num muted">{ing.kcal}</span>
                  </div>
                ))}
              </>
            ) : null}

            <div className="divider" />
            {detail.per === '100g' || detail.source === 'recipe' ? (
              <Field label="Add to today (g)">
                <div className="suffix">
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    value={grams}
                    onChange={(e) => setGrams(e.target.value)}
                  />
                  <span className="unit">g</span>
                </div>
              </Field>
            ) : (
              <p className="muted" style={{ marginBottom: 10 }}>
                Adds one serving: {detail.servingLabel ?? 'as packaged'}.
              </p>
            )}
            <button className="btn primary" onClick={() => void addToToday(detail)}>
              Add to today
            </button>

            {detail.source !== 'builtin' && (
              <>
                <button
                  className="btn mt"
                  onClick={() => {
                    if (detail.source === 'recipe') setRecipe({ food: detail })
                    else setEditor({ food: detail, scanned: false })
                    setDetail(null)
                  }}
                >
                  {detail.source === 'recipe' ? '🧾 Edit recipe' : '✏️ Edit & correct'}
                </button>
                <button
                  className="btn danger mt"
                  onClick={() => {
                    void removeFood(detail.id)
                    setDetail(null)
                  }}
                >
                  Delete food
                </button>
              </>
            )}
            {detail.source === 'builtin' && (
              <p className="tiny center mt">
                Built-in values can't be edited — save your own copy with “New food” if a product
                differs.
              </p>
            )}
          </>
        )}
      </Sheet>

      {editor && (
        <FoodEditor
          food={editor.food}
          scanned={editor.scanned}
          saving={saving}
          error={saveError}
          onClose={() => {
            if (saving) return
            setSaveError(null)
            setEditor(null)
          }}
          onSave={saveFood}
        />
      )}

      <Sheet
        open={chooser}
        onClose={() => setChooser(false)}
        title="Add to your food library"
        sub="What are you adding?"
      >
        <Choice
          emoji="🧾"
          title="Recipe"
          desc="Several ingredients saved as one — overnight oats, curry, a sandwich. The AI estimates each ingredient as you add it, and you can correct anything."
          onClick={() => {
            setChooser(false)
            setRecipe({ food: null })
          }}
        />
        <Choice
          emoji="🏷️"
          title="Single food"
          desc="One item with its own macros — a snack, a jar of peanut butter, a drink."
          onClick={() => {
            setChooser(false)
            setEditor({ food: null, scanned: false })
          }}
        />
        <button className="btn ghost" style={{ width: '100%' }} onClick={() => setChooser(false)}>
          Cancel
        </button>
      </Sheet>

      {recipe && (
        <RecipeEditor
          food={recipe.food}
          saving={saving}
          error={saveError}
          onClose={() => {
            if (saving) return
            setSaveError(null)
            setRecipe(null)
          }}
          onSave={saveFood}
        />
      )}
    </>
  )
}

function FoodRow({ food, onOpen }: { food: Food; onOpen: (f: Food) => void }) {
  const isRecipe = food.source === 'recipe'
  return (
    <button className="list-item" onClick={() => onOpen(food)}>
      <span className="grow">
        <span style={{ fontWeight: 600, fontSize: 14 }}>{food.name}</span>
        <span className="tiny" style={{ display: 'block' }}>
          {isRecipe
            ? `recipe · ${food.ingredients?.length ?? 0} ingredients · ${food.gramsPerServing ?? ''}${food.gramsPerServing ? ' g' : ''}`
            : `${food.per === 'serving' ? food.servingLabel ?? 'per serving' : 'per 100 g'} · ${food.protein}P ·${' '}
              ${food.carbs}C · ${food.fat}F`}
        </span>
      </span>
      <span className="row" style={{ gap: 6 }}>
        {isRecipe ? (
          <span className="chip">recipe</span>
        ) : (
          food.source !== 'builtin' && <span className="chip">yours</span>
        )}
        <span className="num muted">{food.kcal}</span>
      </span>
    </button>
  )
}
