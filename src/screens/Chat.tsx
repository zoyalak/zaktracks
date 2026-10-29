import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { ApiError, sendChat, type ChatMessage } from '../lib/api'
import { mealsOnDate, targetsFor, totalsFor } from '../lib/selectors'
import { EXTRA_KEYS, EXTRA_META, addExtras, emptyExtras, mealToExtras } from '../lib/types'
import { todayKey } from '../lib/date'
import { Notice } from '../components/ui'

export default function Chat() {
  const { profile, meals } = useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  /** Live snapshot of today's numbers, sent with every message. */
  const snapshot = useMemo(() => {
    if (!profile) return { context: '', left: 0, proteinLeft: 0, carbsLeft: 0, fatLeft: 0 }
    const targets = targetsFor(profile)
    const dayMeals = mealsOnDate(meals, todayKey())
    const totals = totalsFor(meals, todayKey())
    const extras = dayMeals.reduce((acc, m) => addExtras(acc, mealToExtras(m)), emptyExtras())
    const left = targets.goalKcal - totals.kcal
    const proteinLeft = Math.max(0, Math.round(targets.macro.protein - totals.protein))
    const carbsLeft = Math.max(0, Math.round(targets.macro.carbs - totals.carbs))
    const fatLeft = Math.max(0, Math.round(targets.macro.fat - totals.fat))

    const lines = [
      `Goal: ${targets.goalKcal} kcal today (${profile.goal} plan).`,
      `Eaten so far: ${totals.kcal} kcal — ${Math.round(totals.protein)} g protein, ${Math.round(totals.carbs)} g carbs, ${Math.round(totals.fat)} g fat.`,
      `Remaining: ${left} kcal — ${proteinLeft} g protein, ${carbsLeft} g carbs, ${fatLeft} g fat.`,
    ]
    const goalKeys = EXTRA_KEYS.filter((k) => (targets.extras[k] ?? 0) > 0)
    if (goalKeys.length) {
      lines.push(
        'Other daily targets and progress: ' +
          goalKeys
            .map(
              (k) =>
                `${EXTRA_META[k].label} ${targets.extras[k]} ${EXTRA_META[k].unit} (so far ${extras[k]} ${EXTRA_META[k].unit})`,
            )
            .join(', ') +
          '.',
      )
    }
    return { context: lines.join('\n'), left, proteinLeft, carbsLeft, fatLeft }
  }, [profile, meals])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, busy])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    setInput('')
    const next: ChatMessage[] = [...messages, { role: 'user', text }]
    setMessages(next)
    setBusy(true)
    try {
      const { reply } = await sendChat(text, next.slice(-10), snapshot.context)
      setMessages((m) => [...m, { role: 'assistant', text: reply }])
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Something went wrong — try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="sub">Your coach</div>
          <h1>Chat</h1>
        </div>
      </div>

      <div className="card tight">
        <div className="row between">
          <div>
            <div className="tiny">Left today</div>
            <div className="big-number num" style={{ fontSize: 24 }}>
              {snapshot.left.toLocaleString()}{' '}
              <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>kcal</span>
            </div>
          </div>
          <div className="num muted" style={{ fontSize: 13.5 }}>
            {snapshot.proteinLeft}P · {snapshot.carbsLeft}C · {snapshot.fatLeft}F
          </div>
        </div>
      </div>

      <div className="chat-list">
        {messages.length === 0 && !busy && (
          <div className="card">
            <div className="empty">
              <span className="big" aria-hidden>
                💬
              </span>
              Tell me what ingredients you have — <b>eggs, spinach, rice and feta</b> — and I'll
              suggest meals that fit what's left in today's macros.
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'msg me' : 'msg bot'}>
            {m.text}
          </div>
        ))}
        {busy && <div className="msg bot">Thinking…</div>}
        <div ref={endRef} />
      </div>

      {error && <Notice type="error">{error}</Notice>}

      <div className="chat-bar">
        <textarea
          className="input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="What's in your kitchen?"
        />
        <button className="btn primary" disabled={!input.trim() || busy} onClick={() => void send()}>
          Send
        </button>
      </div>
    </>
  )
}
