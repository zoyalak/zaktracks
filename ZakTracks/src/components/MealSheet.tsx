import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { LogItem, MealEntry } from '../lib/types'
import {
  EXTRA_KEYS,
  EXTRA_META,
  emptyMacro,
  hasExtras,
  itemsToExtras,
  roundMacro,
  scaleExtras,
} from '../lib/types'
import type { Food } from '../lib/types'
import { formatDayLabel, makeId, shiftKey, todayKey } from '../lib/date'
import { ApiError, estimateIngredient } from '../lib/api'
import { savedFoodRows, searchFoods } from '../lib/foods'
import { useApp } from '../state/AppContext'
import { Disclosure, Field, Notice, Sheet } from './ui'

const emptyItem = (): LogItem => ({ name: '', grams: null, kcal: 0, protein: 0, carbs: 0, fat: 0 })

export default function MealSheet({
  meal,
  isNew,
  goalKcal,
  remainingBefore,
  onClose,
  onSave,
  onDelete,
}: {
  meal: MealEntry
  isNew: boolean
  goalKcal: number
  /** Calories still available before this meal counts. */
  remainingBefore: number
  onClose: () => void
  onSave: (meal: MealEntry) => void
  onDelete?: (id: string) => void
}) {
  const [name, setName] = useState(meal.name)
  const [note, setNote] = useState(meal.note)
  const [items, setItems] = useState<LogItem[]>(meal.items.length ? meal.items : [emptyItem()])
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Rows currently waiting on an AI estimate, by index. */
  const [estimating, setEstimating] = useState<Record<number, boolean>>({})
  const [aiNote, setAiNote] = useState<{ type: 'warn' | 'info'; text: string } | null>(null)
  /** The saved-foods picker, so a label or recipe can go straight into a meal. */
  const { foods } = useApp()
  const [pickOpen, setPickOpen] = useState(false)
  const [pickQuery, setPickQuery] = useState('')
  /** Last food picked, shown under the search box while the picker stays open. */
  const [lastPicked, setLastPicked] = useState('')
  /**
   * The latest rows, readable after an await. Editing a meal means adding a
   * piece you forgot ("some crushed nuts"), which the AI has to price — so a
   * row typed into and left alone gets estimated automatically, and Save waits
   * for any estimate still in flight instead of saving zeros.
   */
  const itemsRef = useRef(items)
  itemsRef.current = items
  const inFlight = useRef<Set<Promise<void>>>(new Set())
  /**
   * Exactly what was typed in each macro field, kept per item so a field the
   * user backs all the way up stays empty instead of snapping back to 0.
   * The parsed number still goes into `items` (0 when blank) so totals never
   * break — only the display differs.
   */
  const [raws, setRaws] = useState<Record<string, string>[]>(() =>
    meal.items.length ? meal.items.map(() => ({})) : [{}],
  )
  const patchRaw = (index: number, key: string, text: string) =>
    setRaws((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: text } : r)))
  const clearRaw = (index: number) => setRaws((prev) => prev.map((r, i) => (i === index ? {} : r)))
  /** What the field shows: the raw keystrokes if the user has edited it, else the number. */
  const displayNum = (index: number, key: string, value: number) => raws[index]?.[key] ?? String(value)

  const totals = useMemo(
    () =>
      roundMacro(
        items.reduce(
          (acc, i) => ({
            kcal: acc.kcal + (i.kcal || 0),
            protein: acc.protein + (i.protein || 0),
            carbs: acc.carbs + (i.carbs || 0),
            fat: acc.fat + (i.fat || 0),
          }),
          emptyMacro(),
        ),
      ),
    [items],
  )

  const extras = useMemo(() => itemsToExtras(items), [items])
  const pickResults = useMemo(() => searchFoods(pickQuery, foods), [pickQuery, foods])
  /** Saved foods by id, so a row can say when its numbers came from one. */
  const savedById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods])

  const remainingAfter = remainingBefore - totals.kcal
  /** Where this meal belongs, in words: today, yesterday or a date. */
  const dayWord =
    meal.date === todayKey()
      ? 'today'
      : meal.date === shiftKey(todayKey(), -1)
        ? 'yesterday'
        : formatDayLabel(meal.date, { weekday: 'short', day: 'numeric', month: 'short' })
  const hasContent = name.trim().length > 0 || items.some((i) => i.name.trim() || i.kcal > 0)

  /**
   * Edit a row in place. Retyping its name or numbers takes it away from the
   * saved food it was priced from, so the "your food" mark goes with them.
   */
  const patch = (index: number, changes: Partial<LogItem>) => {
    const leavesFood = ['name', 'kcal', 'protein', 'carbs', 'fat'].some((k) => k in changes)
    setItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? { ...it, foodId: leavesFood ? undefined : it.foodId, ...changes }
          : it,
      ),
    )
  }

  /**
   * Portion size the grams field was focused on, so every keystroke scales
   * from the original instead of compounding — and so clearing the field and
   * retyping still rescales from the value the macros were calculated for.
   */
  const gramsBase = useRef<{ grams: number | null; item: LogItem } | null>(null)

  const rememberGramsBase = (item: LogItem) => {
    gramsBase.current = { grams: item.grams, item }
  }

  /** Changing the grams rescales this item's macros in real time. */
  const setGrams = (index: number, raw: string) => {
    const parsed = parseFloat(raw)
    const grams = raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0 ? null : parsed
    // Macros may be recomputed from the new portion — drop any typed text for
    // them first so the fields show the rescaled numbers, not stale keystrokes.
    clearRaw(index)
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it
        const base = gramsBase.current?.grams ?? null
        const baseItem = gramsBase.current?.item ?? it
        // No known basis (grams never set, or a zero/blank portion): just record it.
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
      // Emptying the field keeps it empty on screen (no forced 0) while the
      // stored value falls back to 0 so the meal's totals still add up.
      patchRaw(index, key, text)
      patch(index, { [key]: Number.isFinite(n) && n >= 0 ? n : 0 } as Partial<LogItem>)
    }

  /**
   * Ask the AI what a row is worth. With a gram amount it prices that amount;
   * without one it prices a typical serving and fills the grams in.
   */
  const estimateItem = (index: number): Promise<void> => {
    const row = itemsRef.current[index]
    const name = row?.name.trim() ?? ''
    if (!row || !name) return Promise.resolve()
    const grams = row.grams
    setAiNote(null)
    setEstimating((prev) => ({ ...prev, [index]: true }))

    const run = estimateIngredient(name, grams)
      .then((est) => {
        const stillHere = itemsRef.current[index]
        // The row may have been removed while the AI was thinking.
        if (!stillHere || stillHere.name.trim() !== name || stillHere.grams !== grams) return
        const assumed = est.grams > 0 ? est.grams : grams
        const next: LogItem = {
          ...stillHere,
          // The AI is pricing this row now, not the saved food it came from.
          foodId: undefined,
          name: est.name || stillHere.name,
          grams: assumed ?? null,
          kcal: est.kcal,
          protein: est.protein,
          carbs: est.carbs,
          fat: est.fat,
          extras: hasExtras(est.extras) ? est.extras : undefined,
        }
        setItems((prev) => prev.map((it, i) => (i === index ? next : it)))
        // The numbers are fresh — drop any half-typed macro text.
        setRaws((prev) => prev.map((r, i) => (i === index ? {} : r)))
      })
      .catch((err) => {
        const detail = err instanceof ApiError ? err.message : 'Could not reach the AI.'
        setAiNote({
          type: 'warn',
          text: `Couldn't estimate ${name.toLowerCase()} — ${detail} Type its numbers in instead.`,
        })
      })
      .finally(() => {
        inFlight.current.delete(run)
        setEstimating((prev) => {
          const next = { ...prev }
          delete next[index]
          return next
        })
      })
    inFlight.current.add(run)
    return run
  }

  /** Rows worth pricing automatically: named, empty, and not already running. */
  const estimateIfBlank = (index: number) => {
    const row = itemsRef.current[index]
    if (!row || estimating[index]) return
    if (!row.name.trim() || row.name.trim().length < 2) return
    if (row.kcal || row.protein || row.carbs || row.fat) return
    void estimateItem(index)
  }

  /**
   * Drop a saved food into the meal and leave the picker open, so several
   * ingredients of one sandwich can be added without reopening it each time.
   * Blank rows are cleared first so the picked food lands where it can be read.
   */
  const addFood = (food: Food) => {
    const fresh = savedFoodRows(food)
    const keep = itemsRef.current
      .map((it, i) => (it.name.trim() || it.kcal > 0 ? i : -1))
      .filter((i) => i >= 0)
    setItems((prev) => [...keep.map((i) => prev[i]), ...fresh])
    setRaws((prev) => [...keep.map((i) => prev[i] ?? {}), ...fresh.map(() => ({}))])
    setLastPicked(food.name)
  }

  const save = async () => {
    if (inFlight.current.size) await Promise.allSettled([...inFlight.current])
    const clean = itemsRef.current
      .filter((i) => i.name.trim() || i.kcal > 0)
      .map((i) => ({ ...i, name: i.name.trim() || 'Food' }))
    onSave({
      ...meal,
      name: name.trim() || meal.name || 'Meal',
      note: note.trim(),
      items: clean,
    })
    onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'Review this meal' : 'Edit meal'}
      sub={
        isNew
          ? 'Check the numbers — anything the camera got wrong, fix it here.'
          : 'Add or change an item and the AI prices it for you.'
      }
    >
      {aiNote && <Notice type={aiNote.type}>{aiNote.text}</Notice>}
      <div className="row" style={{ gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
        {meal.photo && <img className="photo-preview" style={{ width: 92, height: 92, flex: '0 0 auto' }} src={meal.photo} alt="" />}
        <div className="grow">
          <Field label="Meal name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chicken burrito bowl" />
          </Field>
        </div>
      </div>

      <Field label="What's in it?" hint="Your words, plus the photo's estimate. Edit anything that looks off.">
        <textarea
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Grilled chicken, rice, black beans, salsa, a little sour cream…"
        />
      </Field>

      <div className="card-title" style={{ marginTop: 6 }}>
        <h2>Items</h2>
        <span className="hint">type a new food, then ✨ · or pick a saved one</span>
      </div>

      {items.map((item, index) => (
        <div key={index} style={{ marginBottom: 12 }}>
          <div className="edit-row with-ai">
            <input
              className="input"
              value={item.name}
              placeholder={index === 0 ? 'Grilled chicken' : 'Food'}
              onChange={(e) => patch(index, { name: e.target.value })}
              onBlur={() => estimateIfBlank(index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
            />
            <input
              className="input"
              type="number"
              inputMode="decimal"
              value={item.grams ?? ''}
              placeholder="g"
              onFocus={() => rememberGramsBase(item)}
              onChange={(e) => setGrams(index, e.target.value)}
            />
            <button
              className="icon-btn"
              aria-label={`Estimate ${item.name || 'this item'} with AI`}
              title="Estimate with AI"
              disabled={estimating[index]}
              onClick={() => void estimateItem(index)}
            >
              {estimating[index] ? <span className="spinner" /> : '✨'}
            </button>
            <button
              className="icon-btn"
              aria-label="Remove item"
              onClick={() => {
                setItems((prev) => prev.filter((_, i) => i !== index))
                // Indexes shift after a removal — shift the typed text with them.
                setRaws((prev) => prev.filter((_, i) => i !== index))
              }}
            >
              ✕
            </button>
          </div>
          {estimating[index] && (
            <p className="tiny muted" style={{ marginTop: -4, marginBottom: 8 }}>
              Estimating {item.name || 'this item'}…
            </p>
          )}
          {!estimating[index] && item.foodId && savedById.get(item.foodId) && (
            <div className="row" style={{ gap: 6, marginTop: -4, marginBottom: 8 }}>
              <span className="chip">your food</span>
              <span className="tiny muted">{savedById.get(item.foodId)!.name}</span>
            </div>
          )}
          <div className="edit-macros">
            <div>
              <label>kcal</label>
              <input className="input" type="number" inputMode="decimal"              value={displayNum(index, 'kcal', item.kcal)} onChange={numeric(index, 'kcal')} />
            </div>
            <div>
              <label>protein</label>
              <input className="input" type="number" inputMode="decimal"              value={displayNum(index, 'protein', item.protein)} onChange={numeric(index, 'protein')} />
            </div>
            <div>
              <label>carbs</label>
              <input className="input" type="number" inputMode="decimal"              value={displayNum(index, 'carbs', item.carbs)} onChange={numeric(index, 'carbs')} />
            </div>
            <div>
              <label>fat</label>
              <input className="input" type="number" inputMode="decimal"              value={displayNum(index, 'fat', item.fat)} onChange={numeric(index, 'fat')} />
            </div>
          </div>
        </div>
      ))}

      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn ghost small grow"
          onClick={() => {
            setItems((prev) => [...prev, emptyItem()])
            setRaws((prev) => [...prev, {}])
          }}
        >
          + Add item
        </button>
        <button
          className="btn ghost small grow"
          onClick={() => setPickOpen((open) => !open)}
        >
          🥗 From my foods
        </button>
      </div>

      {pickOpen && (
        <div className="card tight" style={{ marginTop: 10 }}>
          <div className="searchbar">
            <span className="icon" aria-hidden>
              🔍
            </span>
            <input
              className="input"
              autoFocus
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="Search your foods and the built-in table…"
            />
          </div>
          {lastPicked && (
            <p className="tiny muted" style={{ margin: '0 0 6px' }}>
              Added {lastPicked} — keep picking, then close this to edit the meal.
            </p>
          )}
          <div style={{ maxHeight: '34vh', overflowY: 'auto' }}>
            {pickResults.map((f) => (
              <button key={f.id} className="list-item" onClick={() => addFood(f)}>
                <span className="grow">
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</span>
                  <span className="tiny" style={{ display: 'block' }}>
                    {f.source === 'recipe'
                      ? `recipe · ${f.ingredients?.length ?? 0} ingredients`
                      : f.per === 'serving'
                        ? f.servingLabel ?? 'per serving'
                        : `${f.kcal} kcal / 100 g`}
                    {f.source !== 'builtin' ? ' · your food' : ''}
                  </span>
                </span>
                <span className="num muted">{f.kcal}</span>
              </button>
            ))}
            {!pickResults.length && (
              <div className="empty">
                Nothing matched. Add it in Foods → New food, then pick it here.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="total-strip" style={{ marginTop: 14 }}>
        <span className="muted">This meal</span>
        <span className="num" style={{ fontWeight: 650 }}>
          {totals.kcal} kcal · {totals.protein}P · {totals.carbs}C · {totals.fat}F
        </span>
      </div>

      <Disclosure title="More macros" hint="fiber, sugar, minerals…">
        {EXTRA_KEYS.map((k) => (
          <div className="kv" key={k}>
            <span className="k">{EXTRA_META[k].label}</span>
            <span className="v num">
              {extras[k]} {EXTRA_META[k].unit}
            </span>
          </div>
        ))}
      </Disclosure>

      <div className="total-strip">
        <span className="muted">
          {remainingAfter >= 0 ? (dayWord === 'today' ? 'Left today' : `Left on ${dayWord}`) : 'Over your goal by'}
        </span>
        <b className="num" style={{ color: remainingAfter >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
          {Math.abs(remainingAfter).toLocaleString()} kcal
        </b>
      </div>

      {!hasContent && <Notice type="info">Add a name or at least one item with calories to save.</Notice>}

      <div className="btn-row" style={{ marginTop: 6 }}>
        <button className="btn ghost" style={{ flex: '0 0 32%' }} onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!hasContent} onClick={save}>
          {isNew ? `Add to ${dayWord}` : 'Save changes'}
        </button>
      </div>

      {!isNew && onDelete && (
        <button
          className="btn danger"
          style={{ marginTop: 10 }}
          onClick={() => {
            if (confirmDelete) {
              onDelete(meal.id)
              onClose()
            } else {
              setConfirmDelete(true)
            }
          }}
        >
          {confirmDelete ? 'Tap again to delete' : 'Delete meal'}
        </button>
      )}
    </Sheet>
  )
}

/** Build a draft meal entry ready for the editor. */
export function draftMeal(
  partial: Partial<MealEntry> & {
    items: LogItem[]
    source: MealEntry['source']
    date: string
    time: string
  },
): MealEntry {
  return {
    id: partial.id ?? makeId(),
    date: partial.date,
    time: partial.time,
    name: partial.name ?? 'Meal',
    note: partial.note ?? '',
    photo: partial.photo,
    source: partial.source,
    items: partial.    items,
    createdAt: partial.createdAt ?? Date.now(),
  }
}
