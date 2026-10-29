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
/** True when a snapshot holds anything worth keeping. */
const hasContent = (s: Snapshot): boolean =>
  s.authoritative === true ||
  s.profile !== null ||
  s.meals.length > 0 ||
  s.foods.length > 0 ||
  s.settings.weightLog.length > 0

async function absorbSnapshot(loaded: AppData, db: IDBDatabase): Promise<AppData> {
  const snap = readSnapshot()
  if (!hasContent(snap)) return loaded

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
// Write-through mirror
// ---------------------------------------------------------------------------

/**
 * A complete copy of the app state kept in localStorage and refreshed on every
 * save, so IndexedDB losing the data (storage evicted, private mode, a browser
 * that clears site data) can no longer start the user over on onboarding — the
 * next load rebuilds IndexedDB from here.
 *
 * Photos are stripped from the mirror: meal pictures are base64 data URLs that
 * would blow the ~5 MB localStorage quota within days. Recovery therefore
 * restores every number and note, and only the photo thumbnails go missing.
 */
let mirror: Snapshot | null = null

/** Photos are kept in IndexedDB only — never in the localStorage mirror. */
const slimMeal = (m: MealEntry): MealEntry => (m.photo ? { ...m, photo: undefined } : m)

const slimMeals = (meals: MealEntry[]): MealEntry[] => meals.map(slimMeal)

const setMirror = (next: Snapshot): void => {
  mirror = next
  try {
    writeSnapshot(next)
  } catch (err) {
    console.warn('Could not update the localStorage mirror', err)
  }
}

const mirrorWrite = (mutate: (m: Snapshot) => void): void => {
  if (!mirror) mirror = readSnapshot()
  mutate(mirror)
  setMirror(mirror)
}

/** Rebuild IndexedDB from the mirror after the browser threw its data away. */
async function restoreToIdb(db: IDBDatabase, data: AppData): Promise<void> {
  try {
    const t = db.transaction(['kv', 'meals', 'foods'], 'readwrite')
    t.objectStore('kv').clear()
    t.objectStore('meals').clear()
    t.objectStore('foods').clear()
    if (data.profile) t.objectStore('kv').put(data.profile, 'profile')
    t.objectStore('kv').put(data.settings, 'settings')
    for (const m of data.meals) t.objectStore('meals').put(m)
    for (const f of data.foods) t.objectStore('foods').put(f)
    await new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
    console.info('Restored IndexedDB from the localStorage mirror')
  } catch (err) {
    console.warn('Could not rebuild IndexedDB from the mirror', err)
  }
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
    // Only a snapshot with real content is promoted to "this is the whole
    // store": an empty one must never be able to overwrite IndexedDB later.
    const auth = s.authoritative || hasContent(s)
    if (auth && !s.authoritative) {
      // From here on this snapshot *is* the live store, so a later session
      // where IndexedDB works must treat it as the full state, not a patch.
      writeSnapshot({ ...s, authoritative: true })
    }
    const data: AppData = { profile: s.profile, meals: s.meals, foods: s.foods, settings: s.settings }
    setMirror({ profile: s.profile, meals: slimMeals(s.meals), foods: s.foods, settings: s.settings, authoritative: auth })
    return data
  }
  try {
    const db = await getDb()
    const snap = readSnapshot()
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

    // IndexedDB came back empty but the mirror still has the data — the
    // browser evicted the database (or site data was cleared). Rebuild it
    // instead of sending the user through onboarding as if they were new.
    if (!hasContent(loaded) && hasContent(snap)) {
      const restored: AppData = {
        profile: snap.profile,
        meals: [...snap.meals].sort((a, b) => a.createdAt - b.createdAt),
        foods: [...snap.foods].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
        settings: snap.settings,
      }
      await restoreToIdb(db, restored)
      setMirror({
        profile: restored.profile,
        meals: slimMeals(restored.meals),
        foods: restored.foods,
        settings: restored.settings,
      })
      return restored
    }

    const merged = await absorbSnapshot(loaded, db)
    setMirror({
      profile: merged.profile,
      meals: slimMeals(merged.meals),
      foods: merged.foods,
      settings: merged.settings,
    })
    return merged
  } catch (err) {
    console.warn('IndexedDB unavailable, using localStorage', err)
    usingIdb = false
    const s = readSnapshot()
    // This snapshot is the live store from here on — but only if it holds
    // something; an empty one must not be able to wipe IndexedDB later.
    const auth = s.authoritative || hasContent(s)
    setMirror({ profile: s.profile, meals: slimMeals(s.meals), foods: s.foods, settings: s.settings, authoritative: auth })
    return { profile: s.profile, meals: s.meals, foods: s.foods, settings: s.settings }
  }
}

export async function saveProfile(profile: Profile | null): Promise<void> {
  if (usingIdb) {
    await idbWrite(
      'kv',
      (s) => {
        if (profile) s.put(profile, 'profile')
        else s.delete('profile')
      },
      // The mirror written below is the fallback — nothing else to do here.
      () => {},
    )
  }
  mirrorWrite((m) => {
    m.profile = profile
  })
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (usingIdb) await idbWrite('kv', (s) => { s.put(settings, 'settings') }, () => {})
  mirrorWrite((m) => {
    m.settings = settings
  })
}

export async function putMeal(meal: MealEntry): Promise<void> {
  if (usingIdb) await idbWrite('meals', (s) => { s.put(meal) }, () => {})
  mirrorWrite((m) => {
    const idx = m.meals.findIndex((x) => x.id === meal.id)
    const slim = slimMeal(meal)
    if (idx >= 0) m.meals[idx] = slim
    else m.meals.push(slim)
  })
}

export async function deleteMeal(id: string): Promise<void> {
  if (usingIdb) await idbWrite('meals', (s) => { s.delete(id) }, () => {})
  mirrorWrite((m) => {
    m.meals = m.meals.filter((x) => x.id !== id)
  })
}

export async function putFood(food: Food): Promise<void> {
  if (usingIdb) await idbWrite('foods', (s) => { s.put(food) }, () => {})
  mirrorWrite((m) => {
    const idx = m.foods.findIndex((x) => x.id === food.id)
    if (idx >= 0) m.foods[idx] = food
    else m.foods.push(food)
  })
}

export async function deleteFood(id: string): Promise<void> {
  if (usingIdb) await idbWrite('foods', (s) => { s.delete(id) }, () => {})
  mirrorWrite((m) => {
    m.foods = m.foods.filter((x) => x.id !== id)
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
  // Mirror first: an import has to survive even if IndexedDB rejects it.
  setMirror({ ...staged, meals: slimMeals(staged.meals) })
  if (!usingIdb) return
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
    console.warn('IndexedDB import failed, keeping the localStorage mirror', err)
    usingIdb = false
  }
}

export async function clearAll(): Promise<void> {
  await importAll({ profile: null, meals: [], foods: [], settings: defaultSettings() })
}
