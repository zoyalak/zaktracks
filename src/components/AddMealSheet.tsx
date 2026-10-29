import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { ApiError, analyzeMeal, apiHealth, type AnalyzedItem, type ApiHealth } from '../lib/api'
import { fileToDataUrl } from '../lib/photo'
import { estimateFromText, itemsToName } from '../lib/estimate'
import { searchFoods } from '../lib/foods'
import type { Food, LogItem, MealEntry } from '../lib/types'
import { emptyMacro, roundMacro, scaleExtras } from '../lib/types'
import { nowTime, todayKey } from '../lib/date'
import MealSheet, { draftMeal } from './MealSheet'
import { Choice, Field, Loading, Notice, Sheet } from './ui'

const analysisToItems = (items: AnalyzedItem[]): LogItem[] =>
  items.map((i) => ({
    name: i.name,
    grams: i.grams,
    kcal: i.kcal,
    protein: i.protein,
    carbs: i.carbs,
    fat: i.fat,
    extras: i.extras,
  }))

type Mode = 'menu' | 'photo' | 'describe' | 'pick'

export default function AddMealSheet({
  open,
  onClose,
  date = todayKey(),
  goalKcal,
  remaining,
}: {
  open: boolean
  onClose: () => void
  date?: string
  goalKcal: number
  remaining: number
}) {
  const { foods, profile, upsertMeal } = useApp()
  const [mode, setMode] = useState<Mode>('menu')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('Calculating macros…')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<MealEntry | null>(null)
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [photoData, setPhotoData] = useState<string | null>(null)
  const [mealName, setMealName] = useState('')
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ food: Food; grams: string } | null>(null)
  const [cart, setCart] = useState<LogItem[]>([])
  const photoInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setMode('menu')
      setError(null)
      setPending(null)
      setPhotoData(null)
      setMealName('')
      setText('')
      setQuery('')
      setPicked(null)
      setCart([])
      setBusy(false)
      return
    }
    apiHealth().then(setHealth)
  }, [open])

  const results = useMemo(() => searchFoods(query, foods), [query, foods])
  const hasKey = Boolean(health?.hasKey)

  const fail = (err: unknown) => {
    const message =
      err instanceof ApiError
        ? err.code === 'NO_API_KEY'
          ? 'Photo analysis needs a Groq or OpenRouter API key on the server. You can still describe the meal below — that works offline.'
          : err.message
        : (err as Error)?.message ?? 'Something went wrong.'
    setError(message)
  }

  /** Photo chosen — hold it and ask what's on it before spending an AI call. */
  const takePhoto = async (file: File) => {
    setError(null)
    setBusy(true)
    setBusyLabel('Preparing your photo…')
    try {
      const photo = await fileToDataUrl(file)
      setPhotoData(photo.dataUrl)
      setMode('photo')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  /** The user has described the photo — now get the final macro estimate. */
  const calculatePhoto = async () => {
    if (!photoData) return
    setError(null)
    setBusy(true)
    setBusyLabel('Calculating macros…')
    const trimmed = text.trim()
    try {
      const analysis = await analyzeMeal(photoData, trimmed || undefined)
      setPending(
        draftMeal({
          date,
          time: nowTime(),
          name: mealName.trim() || analysis.mealName,
          note: composeNote(trimmed, analysis.warnings),
          photo: photoData,
          items: analysisToItems(analysis.items),
          source: 'photo',
        }),
      )
    } catch (err) {
      // Stay on the form so the photo and their description are never lost.
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const describe = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setError(null)
    setBusy(true)
    setBusyLabel('Calculating macros…')
    try {
      if (hasKey) {
        try {
          const analysis = await analyzeMeal('', trimmed)
          setPending(
            draftMeal({
              date,
              time: nowTime(),
              name: mealName.trim() || analysis.mealName,
              note: composeNote(trimmed, analysis.warnings),
              items: analysisToItems(analysis.items),
              source: 'describe',
            }),
          )
          return
        } catch (err) {
          if (!(err instanceof ApiError) || err.code === 'NO_API_KEY') throw err
          // Fall through to the offline estimate on transient API trouble.
        }
      }
      const { items, unmatched } = estimateFromText(trimmed, foods)
      setPending(
        draftMeal({
          date,
          time: nowTime(),
          name: mealName.trim() || itemsToName(items),
          note: trimmed,
          items,
          source: 'describe',
        }),
      )
      if (unmatched.length && !items.length) {
        setError(`Could not match "${unmatched[0]}". Open the editor and add it by hand — or scan the label in Foods.`)
      }
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const addToCart = (food: Food, grams: number) => {
    const factor = food.per === 'serving' ? 1 : grams / 100
    setCart((prev) => [
      ...prev,
      {
        name: food.per === 'serving' ? food.name : food.name,
        grams: food.per === 'serving' ? (food.gramsPerServing ?? null) : grams,
        kcal: Math.round(food.kcal * factor),
        protein: Math.round(food.protein * factor * 10) / 10,
        carbs: Math.round(food.carbs * factor * 10) / 10,
        fat: Math.round(food.fat * factor * 10) / 10,
        extras: scaleExtras(food.extras, factor),
        foodId: food.id,
      },
    ])
    setPicked(null)
    setQuery('')
  }

  const cartTotals = useMemo(() => roundMacro(cart.reduce((a, i) => ({
    kcal: a.kcal + i.kcal,
    protein: a.protein + i.protein,
    carbs: a.carbs + i.carbs,
    fat: a.fat + i.fat,
  }), emptyMacro())), [cart])

  const saveCart = () => {
    if (!cart.length) return
    setPending(
      draftMeal({ date, time: nowTime(), name: itemsToName(cart), note: '', items: cart, source: 'food' }),
    )
  }

  const saveMeal = async (meal: MealEntry) => {
    await upsertMeal(meal)
    onClose()
  }

  if (pending) {
    return (
      <MealSheet
        meal={pending}
        isNew
        goalKcal={goalKcal}
        remainingBefore={remaining}
        onClose={() => setPending(null)}
        onSave={saveMeal}
      />
    )
  }

  const grams = picked ? (parseFloat(picked.grams) || (picked.food.per === 'serving' ? 1 : 100)) : 100
  const previewFactor = picked?.food.per === 'serving' ? 1 : grams / 100
  const preview = picked ? roundMacro({
    kcal: picked.food.kcal * previewFactor,
    protein: picked.food.protein * previewFactor,
    carbs: picked.food.carbs * previewFactor,
    fat: picked.food.fat * previewFactor,
  }) : null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'menu' ? 'Add a meal' : mode === 'photo' ? 'Photo of your meal' : mode === 'describe' ? 'Describe your meal' : 'Pick your foods'}
      sub={remaining >= 0 ? `${remaining.toLocaleString()} kcal left in today's goal` : `Over today's goal by ${Math.abs(remaining).toLocaleString()} kcal`}
    >
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void takePhoto(f)
          e.target.value = ''
        }}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void takePhoto(f)
          e.target.value = ''
        }}
      />

      {error && <Notice type={hasKey || error.length < 90 ? 'error' : 'warn'}>{error}</Notice>}

      {busy ? (
        <Loading label={busyLabel} />
      ) : (
        <>
          {mode === 'menu' && (
            <>
              <Choice
                emoji="📷"
                title="Snap the plate"
                desc="Take a photo, say what's in it, get the macros"
                onClick={() => setMode('photo')}
              />
              <Choice
                emoji="🗣️"
                title="Describe it"
                desc={hasKey ? 'Type the meal — the AI calculates the macros' : 'Matched against the built-in food table'}
                onClick={() => setMode('describe')}
              />
              <Choice
                emoji="🥗"
                title="Pick from foods"
                desc="Build it from your saved foods and the built-in table"
                onClick={() => setMode('pick')}
              />
              {!hasKey && health && (
                <Notice type="info">
                  No AI API key on the server yet, so photo analysis is off. Add{' '}
                  <b>GROQ_API_KEY</b> (or <b>OPENROUTER_API_KEY</b>) in Profile → AI analysis to
                  switch it on. Everything else works offline.
                </Notice>
              )}
            </>
          )}

          {mode === 'photo' && !photoData && (
            <>
              <p className="muted" style={{ marginBottom: 14 }}>
                Fill the frame with the plate. Next you'll tell us what's in it, so the estimate
                matches what you actually ate.
              </p>
              <button className="btn primary" onClick={() => photoInput.current?.click()}>
                📷 Take a photo
              </button>
              <button className="btn mt" onClick={() => libraryInput.current?.click()}>
                🖼️ Choose from library
              </button>
              <button className="btn ghost mt" onClick={() => setMode('menu')}>
                Back
              </button>
            </>
          )}

          {mode === 'photo' && photoData && (
            <>
              <div className="row" style={{ gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
                <img
                  className="photo-preview"
                  style={{ width: 76, height: 76, flex: '0 0 auto' }}
                  src={photoData}
                  alt="Your meal"
                />
                <div className="grow">
                  <Field label="Name this meal">
                    <input
                      className="input"
                      value={mealName}
                      onChange={(e) => setMealName(e.target.value)}
                      placeholder="e.g. Chicken burrito bowl"
                    />
                  </Field>
                </div>
              </div>
              <Field
                label="What was in it?"
                hint="The more detail you give, the sharper the estimate — foods, portions, cooking method."
              >
                <textarea
                  className="input"
                  style={{ minHeight: 110 }}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. grilled chicken breast, a cup of rice, black beans, salsa, a little sour cream"
                />
              </Field>
              <button className="btn primary mt" onClick={() => void calculatePhoto()}>
                Calculate macros
              </button>
              <button className="btn ghost mt" onClick={() => setPhotoData(null)}>
                Choose a different photo
              </button>
              <button className="btn ghost mt" onClick={() => setMode('menu')}>
                Back
              </button>
            </>
          )}

          {mode === 'describe' && (
            <>
              <Field label="Name this meal">
                <input
                  className="input"
                  value={mealName}
                  onChange={(e) => setMealName(e.target.value)}
                  placeholder="e.g. Breakfast burrito"
                />
              </Field>
              <Field
                label="What was in it?"
                hint="Foods, portions, cooking method — anything you remember."
              >
                <textarea
                  className="input"
                  style={{ minHeight: 110 }}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. 2 eggs scrambled in butter, 2 slices of toast with jam, and a latte"
                />
              </Field>
              <button className="btn primary mt" disabled={!text.trim()} onClick={() => void describe()}>
                Calculate macros
              </button>
              <button className="btn ghost mt" onClick={() => setMode('menu')}>
                Back
              </button>
            </>
          )}

          {mode === 'pick' && (
            <>
              <div className="searchbar">
                <span className="icon" aria-hidden>
                  🔍
                </span>
                <input
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chicken, rice, oatmeal…"
                  autoFocus
                />
              </div>

              {picked && preview ? (
                <div className="card tight">
                  <div className="row between" style={{ marginBottom: 10 }}>
                    <b style={{ fontSize: 14.5 }}>{picked.food.name}</b>
                    <button className="icon-btn" onClick={() => setPicked(null)}>
                      ✕
                    </button>
                  </div>
                  {picked.food.per === 'serving' ? (
                    <div className="muted">One serving: {picked.food.servingLabel ?? 'as packaged'}</div>
                  ) : (
                    <div className="field">
                      <label>Amount (g)</label>
                      <div className="suffix">
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          value={picked.grams}
                          onChange={(e) => setPicked({ ...picked, grams: e.target.value })}
                        />
                        <span className="unit">g</span>
                      </div>
                    </div>
                  )}
                  <div className="total-strip" style={{ marginBottom: 10 }}>
                    <span className="muted">This portion</span>
                    <b className="num">
                      {preview.kcal} kcal · {preview.protein}P · {preview.carbs}C · {preview.fat}F
                    </b>
                  </div>
                  <button className="btn primary" onClick={() => addToCart(picked.food, grams)}>
                    Add to meal
                  </button>
                </div>
              ) : (
                <div style={{ maxHeight: '42vh', overflowY: 'auto' }}>
                  {results.map((f) => (
                    <button
                      key={f.id}
                      className="list-item"
                      onClick={() =>
                        setPicked({ food: f, grams: f.per === 'serving' ? '1' : f.category === 'Fats & nuts' ? '15' : '100' })
                      }
                    >
                      <span className="grow">
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</span>
                        <span className="tiny" style={{ display: 'block' }}>
                          {f.per === 'serving' ? f.servingLabel ?? 'per serving' : `${f.kcal} kcal / 100 g`}
                          {f.source !== 'builtin' ? ' · your food' : ''}
                        </span>
                      </span>
                      <span className="num muted">{f.kcal}</span>
                    </button>
                  ))}
                  {!results.length && <Empty />}
                </div>
              )}

              {cart.length > 0 && (
                <>
                  <div className="divider" />
                  <div className="card-title">
                    <h2>In this meal</h2>
                    <span className="hint">{cart.length} items</span>
                  </div>
                  {cart.map((item, i) => (
                    <div className="row between" key={i} style={{ padding: '6px 0', fontSize: 13.5 }}>
                      <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                        {item.grams ? ` · ${item.grams} g` : ''}
                      </span>
                      <span className="num muted">{item.kcal} kcal</span>
                      <button
                        className="icon-btn"
                        style={{ width: 30, height: 30, fontSize: 13 }}
                        onClick={() => setCart((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="total-strip" style={{ marginTop: 10 }}>
                    <span className="muted">Total</span>
                    <b className="num">
                      {cartTotals.kcal} kcal · {cartTotals.protein}P · {cartTotals.carbs}C · {cartTotals.fat}F
                    </b>
                  </div>
                  <button className="btn primary" onClick={saveCart}>
                    Review meal
                  </button>
                </>
              )}
              <button className="btn ghost mt" onClick={() => setMode('menu')}>
                Back
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  )
}

/** The note keeps the user's own words first; AI warnings append after. */
function composeNote(userText: string, warnings: string[]): string {
  const parts = [userText.trim()]
  if (warnings.length) parts.push(`Heads up: ${warnings.join('; ')}.`)
  return parts.filter(Boolean).join('\n')
}

function Empty() {
  return (
    <div className="empty">
      <span className="big" aria-hidden>
        🔍
      </span>
      Nothing matched. Try a different word, or add it in Foods → New food.
    </div>
  )
}
