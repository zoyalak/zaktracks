/** Client for the ZakTracks Worker (AI vision endpoints, via OpenRouter). */

import type { AiTargets, ExtraMacros, Profile } from './types'

export interface AnalyzedItem {
  name: string
  quantityText: string
  grams: number | null
  kcal: number
  protein: number
  carbs: number
  fat: number
  extras: ExtraMacros
}

export interface MealAnalysis {
  mealName: string
  description: string
  items: AnalyzedItem[]
  confidence: 'high' | 'medium' | 'low'
  warnings: string[]
}

export interface LabelAnalysis {
  name: string
  brand: string
  per: '100g' | 'serving'
  servingLabel: string
  gramsPerServing: number | null
  kcal: number
  protein: number
  carbs: number
  fat: number
  extras: ExtraMacros
  notes: string
}

export interface ApiHealth {
  ok: boolean
  hasKey: boolean
  model: string
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code = 'UNKNOWN') {
    super(message)
    this.status = status
    this.code = code
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('Could not reach the analysis service. Check your connection.', 0, 'NETWORK')
  }

  const text = await res.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON error body */
  }
  const p = payload as { error?: string; code?: string; message?: string } | null
  if (!res.ok) {
    throw new ApiError(
      p?.error ?? p?.message ?? `Analysis failed (${res.status})`,
      res.status,
      p?.code ?? 'HTTP',
    )
  }
  return payload as T
}

export const analyzeMeal = (image: string, hint?: string, signal?: AbortSignal): Promise<MealAnalysis> =>
  post<MealAnalysis>('/api/analyze/meal', { image, hint }, signal)

export const analyzeLabel = (
  image: string,
  nameHint?: string,
  signal?: AbortSignal,
): Promise<LabelAnalysis> => post<LabelAnalysis>('/api/analyze/label', { image, nameHint }, signal)

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

/**
 * Chat with the coach. `context` is a plain-text snapshot of today's
 * numbers (goal, eaten, remaining, targets) that the app builds — the
 * model never invents these.
 */
export const sendChat = (
  message: string,
  history: ChatMessage[],
  context: string,
  signal?: AbortSignal,
): Promise<{ reply: string }> =>
  post<{ reply: string }>('/api/chat', { message, history, context }, signal)

/** Ask the AI for daily macro goals tailored to the user's profile. */
export const getAiTargets = (profile: Profile, goalKcal: number, signal?: AbortSignal): Promise<AiTargets> =>
  post<AiTargets>(
    '/api/goals',
    {
      profile: {
        sex: profile.sex,
        age: profile.age,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        activity: profile.activity,
        goal: profile.goal,
        targetWeightKg: profile.targetWeightKg,
        weeks: profile.weeks,
      },
      goalKcal,
    },
    signal,
  )

export const apiHealth = async (signal?: AbortSignal): Promise<ApiHealth> => {
  try {
    const res = await fetch('/api/health', { signal })
    if (!res.ok) return { ok: false, hasKey: false, model: 'unknown' }
    return (await res.json()) as ApiHealth
  } catch {
    return { ok: false, hasKey: false, model: 'unknown' }
  }
}

/** Human-readable guidance for the "no API key configured" case. */
export const NO_KEY_HELP =
  'Photo analysis needs a Groq or OpenRouter API key on the server. Add GROQ_API_KEY (or OPENROUTER_API_KEY) as a secret (Sites → Secrets for the deployed app, or worker/.dev.vars locally), then reload. You can still log meals by describing them or picking from your foods.'
