import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { LogItem, MealEntry } from '../lib/types'
import { EXTRA_KEYS, EXTRA_META, emptyMacro, itemsToExtras, roundMacro, scaleExtras } from '../lib/types'
import { makeId } from '../lib/date'
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

  const remainingAfter = remainingBefore - totals.kcal
  const hasContent = name.trim().length > 0 || items.some((i) => i.name.trim() || i.kcal > 0)

  const patch = (index: number, changes: Partial<LogItem>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...changes } : it)))

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
      const n = parseFloat(e.target.value)
      patch(index, { [key]: Number.isFinite(n) && n >= 0 ? n : 0 } as Partial<LogItem>)
    }

  const save = () => {
    const clean = items
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
      sub={isNew ? 'Check the numbers — anything the camera got wrong, fix it here.' : undefined}
    >
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
        <span className="hint">kcal & macros per item</span>
      </div>

      {items.map((item, index) => (
        <div key={index} style={{ marginBottom: 12 }}>
          <div className="edit-row">
            <input
              className="input"
              value={item.name}
              placeholder={index === 0 ? 'Grilled chicken' : 'Food'}
              onChange={(e) => patch(index, { name: e.target.value })}
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
              aria-label="Remove item"
              onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <div className="edit-macros">
            <div>
              <label>kcal</label>
              <input className="input" type="number" inputMode="decimal" value={item.kcal} onChange={numeric(index, 'kcal')} />
            </div>
            <div>
              <label>protein</label>
              <input className="input" type="number" inputMode="decimal" value={item.protein} onChange={numeric(index, 'protein')} />
            </div>
            <div>
              <label>carbs</label>
              <input className="input" type="number" inputMode="decimal" value={item.carbs} onChange={numeric(index, 'carbs')} />
            </div>
            <div>
              <label>fat</label>
              <input className="input" type="number" inputMode="decimal" value={item.fat} onChange={numeric(index, 'fat')} />
            </div>
          </div>
        </div>
      ))}

      <button
        className="btn ghost small"
        style={{ width: '100%' }}
        onClick={() => setItems((prev) => [...prev, emptyItem()])}
      >
        + Add item
      </button>

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
        <span className="muted">{remainingAfter >= 0 ? 'Left today' : 'Over your goal by'}</span>
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
          {isNew ? 'Add to today' : 'Save changes'}
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
