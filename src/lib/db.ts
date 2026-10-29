import type { AppData, Food, MealEntry, Profile, Settings } from './types'

/**
 * On-device persistence. IndexedDB is the primary store; if it is unavailable
 * (private browsing, locked-down webviews) we fall back to localStorage so the
 * app still works for the session.
 */

const DB_NAME = 'macrolens'
const DB_VERSION = 1
const LS_KEY = 'macrolens:backup'

const defaultSettings = (): Settings => ({ weightLog: [] })

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('meals')) {
        const store = db.createObjectStore('meals', { keyPath: 'id' })
        store.createIndex('date', 'date')
      }
      if (!db.objectStoreNames.contains('foods')) db.createObjectStore('foods', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      // Mobile browsers close the connection when a PWA is backgrounded or
      // storage is under pressure. Drop the cached handle so the next write
      // reopens it instead of throwing InvalidStateError at the caller.
      db.onclose = () => {
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null // allow a retry on the next call
      reject(req.error)
    }
    req.onblocked = () => {
      dbPromise = null
      reject(new Error('IndexedDB blocked'))
    }
  })
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<any> | void,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let t: IDBTransaction
    try {
      t = db.transaction(store, mode)
    } catch (err) {
      // e.g. InvalidStateError when the browser dropped the connection
      reject(err)
      return
    }
    t.onerror = () => reject(t.error ?? new Error('Transaction failed'))
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'))
    // Reads resolve with the request's result as soon as it lands. Writes may
    // return no request, so they resolve on transaction commit — that is what
    // guarantees the data is actually persisted before a save reports success.
    try {
      const req = run(t.objectStore(store))
      if (req) {
        req.onsuccess = () => resolve(req.result)
      } else {
        t.oncomplete = () => resolve(undefined)
      }
    } catch (err) {
      reject(err)
    }
  })
}

/** Errors that mean "this connection is dead", not "this write is bad". */
const isStaleConnectionError = (err: unknown): boolean => {
  const name = (err as Error)?.name
  return name === 'InvalidStateError' || name === 'TransactionInactiveError' || name === 'AbortError'
}

/**
 * Run a write, transparently reopening the connection if the browser dropped
 * it, and degrading to localStorage rather than losing the data or leaving a
 * spinner hanging. Never rejects.
 */
async function idbWrite(
  store: string,
  run: (s: IDBObjectStore) => IDBRequest<unknown> | IDBRequest<undefined> | void,
  fallback: () => void,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const db = await getDb()
      await tx(db, store, 'readwrite', run)
      return
    } catch (err) {
      if (attempt === 0 && isStaleConnectionError(err)) {
        dbPromise = null // reopen on the next attempt
        continue
      }
      console.warn(`IndexedDB write to "${store}" failed, using localStorage instead`, err)
      usingIdb = false
      try {
        fallback()
      } catch (fallbackErr) {
        console.warn('localStorage fallback failed too', fallbackErr)
      }
      return
    }
  }
}

const idbAvailable = (): boolean => {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// localStorage fallback
// ---------------------------------------------------------------------------

interface Snapshot {
  profile: Profile | null
  meals: MealEntry[]
  foods: Food[]
  settings: Settings
  /**
   * True when this snapshot holds the complete app state — an import/reset, or
   * a session where IndexedDB was unavailable from the start — rather than
   * just the few records written while IndexedDB was wedged mid-session.
   */
  authoritative?: boolean
}

function readSnapshot(): Snapshot {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { profile: null, meals: [], foods: [], settings: defaultSettings() }
    const parsed = JSON.parse(raw) as Partial<Snapshot>
    return {
      profile: parsed.profile ?? null,
      meals: Array.isArray(parsed.meals) ? parsed.meals : [],
      foods: Array.isArray(parsed.foods) ? parsed.foods : [],
      settings: { weightLog: parsed.settings?.weightLog ?? [] },
      authoritative: parsed.authoritative === true,
    }
  } catch {
    return { profile: null, meals: [], foods: [], settings: defaultSettings() }
  }
}

function writeSnapshot(s: Snapshot): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s))
  } catch (err) {
    console.warn('Could not persist to localStorage', err)
  }
}

/**
 * Merge records that were written to localStorage while IndexedDB was wedged
 * into what IndexedDB holds. The snapshot copy wins on an id collision,
 * because it was necessarily written later than the IndexedDB copy.
 */
function mergeFromSnapshot(base: AppData, snap: Snapshot): AppData {
  const foods = [...base.foods]
  for (const f of snap.foods) {
    const i = foods.findIndex((x) => x.id === f.id)
    if (i >= 0) foods[i] = f
    else foods.push(f)
  }
  const meals = [...base.meals]
  for (const m of snap.meals) {
    const i = meals.findIndex((x) => x.id === m.id)
    if (i >= 0) meals[i] = m
    else meals.push(m)
  }
  return {
    profile: snap.profile ?? base.profile,
    meals: meals.sort((a, b) => a.createdAt - b.createdAt),
    foods: foods.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    settings: snap.settings.weightLog.length > 0 ? snap.settings : base.settings,
  }
}

/**
 * A snapshot left behind by a degraded session must not be lost on the next
 * load. Fold it back into IndexedDB (authoritative snapshots replace the
 * whole store, partial ones are unioned in), then drop it so later deletions
 * stick. If IndexedDB refuses the write-back the snapshot is kept: the merged
 * view is still correct for this session and the next load tries again.
 */
async function absorbSnapshot(loaded: AppData, db: IDBDatabase): Promise<AppData> {
  const snap = readSnapshot()
  const meaningful =
    snap.authoritative === true ||
    snap.profile !== null ||
    snap.meals.length > 0 ||
    snap.foods.length > 0 ||
    snap.settings.weightLog.length > 0
  if (!meaningful) return loaded

  const merged: AppData = snap.authoritative
    ? {
        profile: snap.profile,
        meals: [...snap.meals].sort((a, b) => a.createdAt - b.createdAt),
        foods: [...snap.foods].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
        settings: snap.settings,
      }
    : mergeFromSnapshot(loaded, snap)

  try {
    const t = db.transaction(['kv', 'meals', 'foods'], 'readwrite')
    if (snap.authoritative) {
      t.objectStore('kv').clear()
      t.objectStore('meals').clear()
      t.objectStore('foods').clear()
    }
    const kv = t.objectStore('kv')
    if (snap.profile) kv.put(snap.profile, 'profile')
    if (snap.authoritative || snap.settings.weightLog.length > 0) kv.put(snap.settings, 'settings')
    for (const m of snap.meals) t.objectStore('meals').put(m)
    for (const f of snap.foods) t.objectStore('foods').put(f)
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
    localStorage.removeItem(LS_KEY)
  } catch (err) {
    console.warn('Could not fold the localStorage fallback back into IndexedDB', err)
  }
  return merged
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let usingIdb = idbAvailable()
let dbPromise: Promise<IDBDatabase> | null = null

const getDb = (): Promise<IDBDatabase> => {
  if (!dbPromise) dbPromise = openDb()
  return dbPromise
}

export const storageMode = (): 'indexeddb' | 'localstorage' => (usingIdb ? 'indexeddb' : 'localstorage')

export async function loadAll(): Promise<AppData> {
  if (!usingIdb) {
    const s = readSnapshot()
    if (!s.authoritative) {
      // From here on this snapshot *is* the live store, so a later session
      // where IndexedDB works must treat it as the full state, not a patch.
      writeSnapshot({ ...s, authoritative: true })
    }
    return { profile: s.profile, meals: s.meals, foods: s.foods, settings: s.settings }
  }
  try {
    const db = await getDb()
    const profile = await tx<Profile | undefined>(db, 'kv', 'readonly', (s) => s.get('profile'))
    const settings = await tx<Settings | undefined>(db, 'kv', 'readonly', (s) => s.get('settings'))
    const meals = await tx<MealEntry[]>(db, 'meals', 'readonly', (s) => s.getAll())
    const foods = await tx<Food[]>(db, 'foods', 'readonly', (s) => s.getAll())
    const loaded: AppData = {
      profile: profile ?? null,
      meals: (meals ?? []).sort((a, b) => a.createdAt - b.createdAt),
      foods: (foods ?? []).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
      settings: { weightLog: settings?.weightLog ?? [] },
    }
    return absorbSnapshot(loaded, db)
  } catch (err) {
    console.warn('IndexedDB unavailable, using localStorage', err)
    usingIdb = false
    const s = readSnapshot()
    return { profile: s.profile, meals: s.meals, foods: s.foods, settings: s.settings }
  }
}

export async function saveProfile(profile: Profile | null): Promise<void> {
  if (!usingIdb) {
    const s = readSnapshot()
    s.profile = profile
    writeSnapshot(s)
    return
  }
  await idbWrite('kv', (s) => {
    if (profile) s.put(profile, 'profile')
    else s.delete('profile')
  }, () => {
    const s = readSnapshot()
    s.profile = profile
    writeSnapshot(s)
  })
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!usingIdb) {
    const s = readSnapshot()
    s.settings = settings
    writeSnapshot(s)
    return
  }
  await idbWrite('kv', (s) => { s.put(settings, 'settings') }, () => {
    const s = readSnapshot()
    s.settings = settings
    writeSnapshot(s)
  })
}

export async function putMeal(meal: MealEntry): Promise<void> {
  if (!usingIdb) {
    const s = readSnapshot()
    const idx = s.meals.findIndex((m) => m.id === meal.id)
    if (idx >= 0) s.meals[idx] = meal
    else s.meals.push(meal)
    writeSnapshot(s)
    return
  }
  await idbWrite('meals', (s) => { s.put(meal) }, () => {
    const s = readSnapshot()
    const idx = s.meals.findIndex((m) => m.id === meal.id)
    if (idx >= 0) s.meals[idx] = meal
    else s.meals.push(meal)
    writeSnapshot(s)
  })
}

export async function deleteMeal(id: string): Promise<void> {
  if (!usingIdb) {
    const s = readSnapshot()
    s.meals = s.meals.filter((m) => m.id !== id)
    writeSnapshot(s)
    return
  }
  await idbWrite('meals', (s) => { s.delete(id) }, () => {
    const s = readSnapshot()
    s.meals = s.meals.filter((m) => m.id !== id)
    writeSnapshot(s)
  })
}

export async function putFood(food: Food): Promise<void> {
  if (!usingIdb) {
    const s = readSnapshot()
    const idx = s.foods.findIndex((f) => f.id === food.id)
    if (idx >= 0) s.foods[idx] = food
    else s.foods.push(food)
    writeSnapshot(s)
    return
  }
  await idbWrite('foods', (s) => { s.put(food) }, () => {
    const s = readSnapshot()
    const idx = s.foods.findIndex((f) => f.id === food.id)
    if (idx >= 0) s.foods[idx] = food
    else s.foods.push(food)
    writeSnapshot(s)
  })
}

export async function deleteFood(id: string): Promise<void> {
  if (!usingIdb) {
    const s = readSnapshot()
    s.foods = s.foods.filter((f) => f.id !== id)
    writeSnapshot(s)
    return
  }
  await idbWrite('foods', (s) => { s.delete(id) }, () => {
    const s = readSnapshot()
    s.foods = s.foods.filter((f) => f.id !== id)
    writeSnapshot(s)
  })
}

export async function importAll(data: AppData): Promise<void> {
  const staged: Snapshot = {
    profile: data.profile,
    meals: data.meals ?? [],
    foods: data.foods ?? [],
    settings: data.settings ?? defaultSettings(),
    // An import replaces everything, so the snapshot must replace IndexedDB
    // wholesale when it is folded back, not just union in.
    authoritative: true,
  }
  if (!usingIdb) {
    writeSnapshot(staged)
    return
  }
  try {
    const db = await getDb()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['kv', 'meals', 'foods'], 'readwrite')
      t.objectStore('kv').clear()
      t.objectStore('meals').clear()
      t.objectStore('foods').clear()
      if (data.profile) t.objectStore('kv').put(data.profile, 'profile')
      t.objectStore('kv').put(data.settings ?? defaultSettings(), 'settings')
      for (const m of data.meals ?? []) t.objectStore('meals').put(m)
      for (const f of data.foods ?? []) t.objectStore('foods').put(f)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } catch (err) {
    console.warn('IndexedDB import failed, staging in localStorage instead', err)
    usingIdb = false
    writeSnapshot(staged)
  }
}

export async function clearAll(): Promise<void> {
  await importAll({ profile: null, meals: [], foods: [], settings: defaultSettings() })
}
