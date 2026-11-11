/**
 * Account + cloud sync client.
 *
 * The signed-in session is a bearer token kept in localStorage; every account
 * request sends it so the Worker can scope reads and writes to that user.
 * IndexedDB stays the fast local cache — the server is the source of truth
 * when signing in on a new device.
 */

import type { AppData, Food, MealEntry, Profile, Settings, WeightPoint } from './types'

const SESSION_KEY = 'macrolens:session'

export interface AccountUser {
  id: string
  email: string
}

export interface StoredSession {
  token: string
  user: AccountUser
}

export interface RemoteState {
  profile: Profile | null
  settings: Settings | null
  meals: MealEntry[]
  foods: Food[]
}

export class SyncError extends Error {
  status: number
  code: string
  constructor(message: string, status = 0, code = 'UNKNOWN') {
    super(message)
    this.status = status
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

export function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (!parsed?.token || !parsed.user?.email) return null
    return {
      token: String(parsed.token),
      user: { id: String(parsed.user.id ?? ''), email: String(parsed.user.email) },
    }
  } catch {
    return null
  }
}

export function writeSession(session: StoredSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage blocked — the app still works for this session */
  }
}

export const sessionToken = (): string | null => readSession()?.token ?? null

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new SyncError('Could not reach the server. Check your connection.', 0, 'NETWORK')
  }

  const text = await res.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON body */
  }
  const p = payload as { error?: string; code?: string } | null
  if (!res.ok) {
    throw new SyncError(p?.error ?? `Request failed (${res.status}).`, res.status, p?.code ?? 'HTTP')
  }
  return payload as T
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const asSession = (res: { token: string; user: AccountUser }): StoredSession => ({
  token: res.token,
  user: { id: res.user.id, email: res.user.email },
})

export async function registerAccount(email: string, password: string): Promise<StoredSession> {
  return asSession(
    await request<{ token: string; user: AccountUser }>('/api/auth/register', {
      method: 'POST',
      body: { email, password },
    }),
  )
}

export async function loginAccount(email: string, password: string): Promise<StoredSession> {
  return asSession(
    await request<{ token: string; user: AccountUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),
  )
}

export async function logoutAccount(token: string): Promise<void> {
  await request('/api/auth/logout', { method: 'POST', token })
}

// ---------------------------------------------------------------------------
// Data sync
// ---------------------------------------------------------------------------

export function pullAll(token: string): Promise<RemoteState> {
  return request<RemoteState>('/api/sync', { token })
}

/** Full-state replace — used for the first upload and after an import. */
export function pushAll(token: string, data: AppData): Promise<unknown> {
  return request('/api/sync', {
    method: 'PUT',
    token,
    body: {
      profile: data.profile,
      settings: data.settings,
      meals: data.meals,
      foods: data.foods,
    },
  })
}

export const pushMeal = (token: string, meal: MealEntry): Promise<unknown> =>
  request('/api/sync/meal', { method: 'POST', token, body: { meal } })

export const deleteMealRemote = (token: string, id: string): Promise<unknown> =>
  request(`/api/sync/meal?id=${encodeURIComponent(id)}`, { method: 'DELETE', token })

export const pushFood = (token: string, food: Food): Promise<unknown> =>
  request('/api/sync/food', { method: 'POST', token, body: { food } })

export const deleteFoodRemote = (token: string, id: string): Promise<unknown> =>
  request(`/api/sync/food?id=${encodeURIComponent(id)}`, { method: 'DELETE', token })

export const pushProfileRemote = (token: string, profile: Profile | null): Promise<unknown> =>
  request('/api/sync/profile', { method: 'PUT', token, body: { profile } })

export const pushSettingsRemote = (token: string, settings: Settings): Promise<unknown> =>
  request('/api/sync/settings', { method: 'PUT', token, body: { settings } })

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Union local and cloud state after a sign-in. Ids are unique per record, so
 * the union can't invent duplicates; on a collision the cloud copy wins, but a
 * locally stored meal photo is kept because photos are never uploaded.
 */
export function mergeRemote(local: AppData, remote: RemoteState): AppData {
  const meals = new Map<string, MealEntry>()
  for (const m of local.meals) meals.set(m.id, m)
  for (const m of remote.meals) {
    if (!m || typeof m.id !== 'string') continue
    const existing = meals.get(m.id)
    meals.set(m.id, existing?.photo && !m.photo ? { ...m, photo: existing.photo } : m)
  }

  const foods = new Map<string, Food>()
  for (const f of local.foods) foods.set(f.id, f)
  for (const f of remote.foods) {
    if (!f || typeof f.id !== 'string') continue
    foods.set(f.id, f)
  }

  const weights = new Map<string, WeightPoint>()
  for (const w of local.settings.weightLog) weights.set(w.date, w)
  for (const w of remote.settings?.weightLog ?? []) weights.set(w.date, w)

  return {
    profile: remote.profile ?? local.profile,
    meals: [...meals.values()].sort((a, b) => a.createdAt - b.createdAt),
    foods: [...foods.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    settings: { weightLog: [...weights.values()].sort((a, b) => a.date.localeCompare(b.date)) },
  }
}
