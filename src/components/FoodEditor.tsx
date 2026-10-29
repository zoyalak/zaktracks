import { useState } from 'react'
import type { ExtraKey, Food } from '../lib/types'
import { EXTRA_KEYS, EXTRA_META } from '../lib/types'
import { makeId } from '../lib/date'
import { Disclosure, Field, Notice, Segmented, Sheet } from './ui'

export default function FoodEditor({
  food,
  scanned,
  saving = false,
  error = null,
  onClose,
  onSave,
}: {
  food: Food | null
  scanned: boolean
  saving?: boolean
  error?: string | null
  onClose: () => void
  onSave: (food: Food) => void | Promise<void>
}) {
  const [name, setName] = useState(food?.name ?? '')
  const [brand, setBrand] = useState(food?.brand ?? '')
  const [per, setPer] = useState<'100g' | 'serving'>(food?.per ?? '100g')
  const [servingLabel, setServingLabel] = useState(food?.servingLabel ?? '')
  const [gramsPerServing, setGramsPerServing] = useState(food?.gramsPerServing ? String(food.gramsPerServing) : '')
  const [kcal, setKcal] = useState(food ? String(food.kcal) : '')
  const [protein, setProtein] = useState(food ? String(food.protein) : '')
  const [carbs, setCarbs] = useState(food ? String(food.carbs) : '')
  const [fat, setFat] = useState(food ? String(food.fat) : '')
  const [extras, setExtras] = useState<Record<ExtraKey, string>>(() =>
    Object.fromEntries(
      EXTRA_KEYS.map((k) => [k, food?.extras?.[k] ? String(food.extras[k]) : '']),
    ) as Record<ExtraKey, string>,
  )
  const extrasOpen = EXTRA_KEYS.some((k) => extras[k] !== '')

  const n = (v: string): number => {
    const x = parseFloat(v)
    return Number.isFinite(x) && x >= 0 ? x : 0
  }
  const valid = name.trim().length > 0 && (n(kcal) > 0 || n(protein) > 0 || n(carbs) > 0 || n(fat) > 0)

  const save = () => {
    if (saving) return
    const next: Food = {
      id: food?.id ?? makeId(),
      name: name.trim(),
      brand: brand.trim() || undefined,
      per,
      servingLabel: per === 'serving' ? servingLabel.trim() || '1 serving' : undefined,
      gramsPerServing: per === 'serving' ? n(gramsPerServing) || undefined : undefined,
      kcal: n(kcal),
      protein: n(protein),
      carbs: n(carbs),
      fat: n(fat),
      extras: (() => {
        const e = Object.fromEntries(EXTRA_KEYS.map((k) => [k, n(extras[k])]))
        return EXTRA_KEYS.some((k) => e[k] > 0) ? (e as Record<ExtraKey, number>) : undefined
      })(),
      source: food?.source === 'builtin' ? 'manual' : (food?.source ?? 'manual'),
      category: food?.category ?? 'My foods',
      createdAt: food?.createdAt ?? Date.now(),
    }
    onSave(next)
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={scanned ? 'Check the label' : food ? 'Edit food' : 'New food'}
      sub={scanned ? 'These numbers came off the photo — correct anything it misread.' : 'Saved to your foods and searchable forever.'}
    >
      {scanned && !valid && (
        <Notice type="warn">Some values are missing. Fill in what the label shows before saving.</Notice>
      )}
      {error && <Notice type="error">{error}</Notice>}

      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Peanut butter, crunchy" />
      </Field>
      <Field label="Brand (optional)">
        <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Meridian" />
      </Field>

      <Field label="Values apply to">
        <Segmented
          options={[
            { value: '100g', label: 'Per 100 g' },
            { value: 'serving', label: 'Per serving' },
          ]}
          value={per}
          onChange={(v) => setPer(v)}
        />
      </Field>

      {per === 'serving' && (
        <div className="field-row">
          <Field label="Serving">
            <input
              className="input"
              value={servingLabel}
              onChange={(e) => setServingLabel(e.target.value)}
              placeholder="1 cup (240 ml)"
            />
          </Field>
          <Field label="Serving grams">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              value={gramsPerServing}
              onChange={(e) => setGramsPerServing(e.target.value)}
              placeholder="240"
            />
          </Field>
        </div>
      )}

      <Field label="Calories">
        <div className="suffix">
          <input className="input" type="number" inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="0" />
          <span className="unit">kcal</span>
        </div>
      </Field>

      <div className="edit-macros">
        <div>
          <label>protein g</label>
          <input className="input" type="number" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </div>
        <div>
          <label>carbs g</label>
          <input className="input" type="number" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
        </div>
        <div>
          <label>fat g</label>
          <input className="input" type="number" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
        </div>
        <div>
          <label>check</label>
          <input
            className="input"
            readOnly
            value={`${Math.round(n(protein) * 4 + n(carbs) * 4 + n(fat) * 9)} kcal`}
            style={{ opacity: 0.75 }}
          />
        </div>
      </div>
      <p className="tiny" style={{ marginTop: -6, marginBottom: 14 }}>
        The check box shows what the macros add up to, so you can spot a typo against the label.
      </p>

      <Disclosure title="More macros" hint="fiber, sugar, minerals…" defaultOpen={extrasOpen}>
        {EXTRA_KEYS.map((k) => (
          <div className="field" key={k}>
            <label>
              {EXTRA_META[k].label} ({EXTRA_META[k].unit})
            </label>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              value={extras[k]}
              placeholder="—"
              onChange={(e) => setExtras((prev) => ({ ...prev, [k]: e.target.value }))}
            />
          </div>
        ))}
        <p className="tiny" style={{ marginTop: -2 }}>
          Leave blank if the label doesn't print them. Values use the same basis as above (per 100 g
          or per serving).
        </p>
      </Disclosure>

      <div className="btn-row">
        <button className="btn ghost" style={{ flex: '0 0 32%' }} onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save food'}
        </button>
      </div>
    </Sheet>
  )
}
