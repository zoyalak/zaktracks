import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { Food, LogItem } from '../lib/types'
import {
  hasExtras,
  itemsToExtras,
  itemsToGrams,
  itemsToMacro,
  roundMacro,
  scaleExtras,
} from '../lib/types'
import { makeId } from '../lib/date'
import { ApiError, estimateIngredient } from '../lib/api'
import { matchIngredient } from '../lib/estimate'
import { useApp } from '../state/AppContext'
import { Field, Loading, Notice, Sheet } from './ui'

type AddNote = { type: 'warn' | 'info'; text: string } | null

/**
 * Build a reusable multi-ingredient meal — "overnight oats", a curry, a
 * sandwich. Each ingredient is sent to the AI for an estimate as it is added,
 * and every number stays editable afterwards. Totals are stored on the Food
 * itself so the food library, search and "add to today" all keep working.
 */
export default function RecipeEditor({
  food,
  saving = false,
  error = null,
  onClose,
  onSave,
}: {
  food: Food | null
  saving?: boolean
  error?: string | null
  onClose: () => void
  onSave: (food: Food) => void | Promise<void>
}) {
  const { foods } = useApp()
  const [name, setName] = useState(food?.name ?? '')
  const [items, setItems] = useState<LogItem[]>(food?.ingredients ?? [])
  /**
   * Exactly what was typed in each field, per ingredient, so a field the user
   * backs all the way up stays empty instead of snapping back to 0 — the same
   * rule the meal editor follows.
   */
  const [raws, setRaws] = useState<Record<string, string>[]>(() =>
    (food?.ingredients ?? []).map(() => ({})),
  )
  const [ingName, setIngName] = useState('')
  const [ingGrams, setIngGrams] = useState('')
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<AddNote>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const totals = useMemo(() => roundMacro(itemsToMacro(items)), [items])
  const totalGrams = useMemo(() => itemsToGrams(items), [items])

  const patchRaw = (index: number, key: string, text: string) =>
    setRaws((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: text } : r)))
  /** What the field shows: the raw keystrokes if edited, else the number. */
  const displayNum = (index: number, key: string, value: number | string) =>
    raws[index]?.[key] ?? String(value)

  const patch = (index: number, changes: Partial<LogItem>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...changes } : it)))

  /**
   * The grams this ingredient was built from, captured on focus, so every
   * keystroke scales from the original instead of compounding.
   */
  const gramsBase = useRef<{ grams: number | null; item: LogItem } | null>(null)
  const rememberGramsBase = (item: LogItem) => {
    gramsBase.current = { grams: item.grams, item }
  }

  /** Changing the grams rescales that ingredient's macros in real time. */
  const setGrams = (index: number, raw: string) => {
    const parsed = parseFloat(raw)
    const grams = raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0 ? null : parsed
    // Keep the keystrokes in the grams field, but drop typed macro text —
    // those fields are about to show the rescaled numbers.
    setRaws((prev) => prev.map((r, i) => (i === index ? { grams: raw } : r)))
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it
        const base = gramsBase.current?.grams ?? null
        const baseItem = gramsBase.current?.item ?? it
        if (grams === null || base === null || !(base > 0) || !(grams > 0)) return { ...it, grams }
        const f = grams / base
        const r1 = (x: number) => Math.round(x * f * 10) / 10
        return {
          ...it,
          grams,
          kcal: Math.round(baseItem.kcal * f),
          protein: r1(baseItem.protein),
          carbs: r1(baseItem.carbs),
          fat: r1(baseItem.fat),
          extras: scaleExtras(baseItem.extras, f) ?? it.extras,
        }
      }),
    )
  }

  const numeric =
    (index: number, key: 'kcal' | 'protein' | 'carbs' | 'fat') =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value
      const n = parseFloat(text)
      patchRaw(index, key, text)
      patch(index, { [key]: Number.isFinite(n) && n >= 0 ? n : 0 } as Partial<LogItem>)
    }

  /** AI estimate first; the built-in table only steps in when the AI can't. */
  const estimateOrFallback = async (
    ingredient: string,
    grams: number,
  ): Promise<{ item: LogItem; note: AddNote }> => {
    try {
      const est = await estimateIngredient(ingredient, grams)
      return {
        item: {
          name: est.name || ingredient,
          grams,
          kcal: est.kcal,
          protein: est.protein,
          carbs: est.carbs,
          fat: est.fat,
          extras: hasExtras(est.extras) ? est.extras : undefined,
        },
        note: null,
      }
    } catch (err) {
      const local = matchIngredient(ingredient, grams, foods)
      if (local) {
        return {
          item: local,
          note: {
            type: 'warn',
            text: `The AI didn't answer, so ${ingredient} was matched from the built-in food table instead — check the numbers.`,
          },
        }
      }
      const detail = err instanceof ApiError ? err.message : 'Could not reach the AI.'
      return {
        item: { name: ingredient, grams, kcal: 0, protein: 0, carbs: 0, fat: 0 },
        note: { type: 'warn', text: `${detail} ${ingredient} was added with blank numbers — fill them in.` },
      }
    }
  }

  const add = async () => {
    if (pending) return
    const ingredient = ingName.trim()
    const grams = parseFloat(ingGrams)
    if (!ingredient) {
      setNote({ type: 'warn', text: 'Enter the ingredient first, e.g. "Oats".' })
      return
    }
    if (!Number.isFinite(grams) || grams <= 0) {
      setNote({ type: 'warn', text: `Enter how much ${ingredient.toLowerCase()} you're using, in grams.` })
      return
    }
    setNote(null)
    setPending(true)
    const result = await estimateOrFallback(ingredient, grams)
    setItems((prev) => [...prev, result.item])
    setRaws((prev) => [...prev, {}])
    setIngName('')
    setIngGrams('')
    setNote(result.note)
    setPending(false)
  }

  const save = () => {
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Please enter a name for this recipe, e.g. Overnight oats.')
      return
    }
    setNameError(null)
    const clean = items
      .filter((i) => i.name.trim() || i.kcal > 0)
      .map((i) => ({ ...i, name: i.name.trim() }))
    if (!clean.length) {
      setListError('Add at least one ingredient before saving.')
      return
    }
    if (clean.some((i) => !i.name)) {
      setListError('Every ingredient needs a name — fill it in or remove the row.')
      return
    }
    if (!(itemsToMacro(clean).kcal > 0)) {
      setListError('These ingredients have no calories yet — check the numbers before saving.')
      return
    }
    setListError(null)

    const t = itemsToMacro(clean)
    const extras = itemsToExtras(clean)
    const grams = itemsToGrams(clean)
    const next: Food = {
      id: food?.id ?? makeId(),
      name: trimmed,
      per: 'serving',
      servingLabel: 'the whole recipe',
      gramsPerServing: grams > 0 ? grams : undefined,
      kcal: t.kcal,
      protein: t.protein,
      carbs: t.carbs,
      fat: t.fat,
      extras: hasExtras(extras) ? extras : undefined,
      ingredients: clean,
      source: 'recipe',
      category: 'Recipes',
      createdAt: food?.createdAt ?? Date.now(),
    }
    void onSave(next)
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={food ? 'Edit recipe' : 'New recipe'}
      sub="Type an ingredient and its amount — the AI estimates the calories, then you can correct anything. Save it once and it's ready every time."
    >
      {nameError && <Notice type="warn">{nameError}</Notice>}
      {listError && <Notice type="warn">{listError}</Notice>}
      {error && <Notice type="error">{error}</Notice>}
      {note && <Notice type={note.type}>{note.text}</Notice>}

      <Field label="Recipe name">
        <input
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (nameError) setNameError(null)
          }}
          placeholder="e.g. Overnight oats"
        />
      </Field>

      <div className="card-title" style={{ marginTop: 6 }}>
        <h2>Ingredients</h2>
        <span className="hint">{items.length ? `${items.length} added` : 'AI estimates each one'}</span>
      </div>

      <div className="edit-row" style={{ gridTemplateColumns: '1fr 74px auto' }}>
        <input
          className="input"
          value={ingName}
          placeholder="e.g. Oats"
          disabled={pending}
          onChange={(e) => {
            setIngName(e.target.value)
            if (note) setNote(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
        />
        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={ingGrams}
          placeholder="g"
          disabled={pending}
          onChange={(e) => setIngGrams(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
        />
        <button className="btn primary small" disabled={pending} onClick={() => void add()}>
          {pending ? '…' : 'Add'}
        </button>
      </div>
      <p className="tiny" style={{ marginTop: -2, marginBottom: 12 }}>
        Enter the amount you're using, then tap Add — the AI works out its calories.
      </p>

      {pending && <Loading label="Estimating this ingredient…" />}

      {!items.length && !pending && (
        <p className="tiny muted" style={{ marginBottom: 12 }}>
          No ingredients yet — add the first one above.
        </p>
      )}

      {items.map((item, index) => (
        <div key={index} style={{ marginBottom: 4 }}>
          <div className="edit-row">
            <input
              className="input"
              value={item.name}
              placeholder="Ingredient"
              onChange={(e) => patch(index, { name: e.target.value })}
            />
            <input
              className="input"
              type="number"
              inputMode="decimal"
              placeholder="g"
              value={displayNum(index, 'grams', item.grams ?? '')}
              onFocus={() => rememberGramsBase(item)}
              onChange={(e) => setGrams(index, e.target.value)}
            />
            <button
              className="icon-btn"
              aria-label={`Remove ${item.name || 'ingredient'}`}
              onClick={() => {
                setItems((prev) => prev.filter((_, i) => i !== index))
                // Indexes shift after a removal — shift the typed text with them.
                setRaws((prev) => prev.filter((_, i) => i !== index))
              }}
            >
              ✕
            </button>
          </div>
          <div className="edit-macros">
            <div>
              <label>kcal</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={displayNum(index, 'kcal', item.kcal)}
                onChange={numeric(index, 'kcal')}
              />
            </div>
            <div>
              <label>protein</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={displayNum(index, 'protein', item.protein)}
                onChange={numeric(index, 'protein')}
              />
            </div>
            <div>
              <label>carbs</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={displayNum(index, 'carbs', item.carbs)}
                onChange={numeric(index, 'carbs')}
              />
            </div>
            <div>
              <label>fat</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={displayNum(index, 'fat', item.fat)}
                onChange={numeric(index, 'fat')}
              />
            </div>
          </div>
        </div>
      ))}

      {items.length > 0 && (
        <div className="total-strip">
          <span className="muted">Total{totalGrams > 0 ? ` · ${totalGrams} g` : ''}</span>
          <span className="num" style={{ fontWeight: 650 }}>
            {totals.kcal} kcal · {totals.protein}P · {totals.carbs}C · {totals.fat}F
          </span>
        </div>
      )}

      <div className="btn-row">
        <button className="btn ghost" style={{ flex: '0 0 32%' }} onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save recipe'}
        </button>
      </div>
    </Sheet>
  )
}
