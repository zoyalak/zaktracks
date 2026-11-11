import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AppData, Food, MealEntry, Profile, Settings } from '../lib/types'
import * as db from '../lib/db'
import { todayKey } from '../lib/date'
import {
  SyncError,
  deleteFoodRemote,
  deleteMealRemote,
  loginAccount,
  logoutAccount,
  mergeRemote,
  pullAll,
  pushAll,
  pushFood,
  pushMeal,
  pushProfileRemote,
  pushSettingsRemote,
  readSession,
  registerAccount,
  sessionToken,
  writeSession,
  type AccountUser,
  type StoredSession,
} from '../lib/sync'

interface AppContextValue extends AppData {
  ready: boolean
  user: AccountUser | null
  storageMode: 'indexeddb' | 'localstorage'
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  saveProfile: (profile: Profile | null) => Promise<void>
  upsertMeal: (meal: MealEntry) => Promise<void>
  removeMeal: (id: string) => Promise<void>
  upsertFood: (food: Food) => Promise<void>
  removeFood: (id: string) => Promise<void>
  logWeight: (kg: number, date?: string) => Promise<void>
  importData: (data: AppData) => Promise<void>
  resetAll: () => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

const emptyData = (): AppData => ({ profile: null, meals: [], foods: [], settings: { weightLog: [] } })

/** Fire-and-forget cloud write: the local save already succeeded. */
const background = (p: Promise<unknown> | null): void => {
  if (p) void p.catch(() => undefined)
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<'indexeddb' | 'localstorage'>('indexeddb')
  const [user, setUser] = useState<AccountUser | null>(null)
  const dataRef = useRef<AppData>(data)
  dataRef.current = data

  const commit = useCallback((next: AppData) => {
    dataRef.current = next
    setData(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const local = await db.loadAll()
      if (cancelled) return
      commit(local)
      setMode(db.storageMode())

      const session = readSession()
      if (session) {
        try {
          const remote = await pullAll(session.token)
          if (cancelled) return
          // Local logs made offline are unioned with the account's, so a
          // first sign-in never drops meals that were already recorded.
          const merged = mergeRemote(local, remote)
          commit(merged)
          setUser(session.user)
          await db.importAll(merged)
          background(pushAll(session.token, merged))
        } catch (err) {
          if (err instanceof SyncError && err.status === 401) {
            writeSession(null)
            setUser(null)
          } else if (!cancelled) {
            // Offline: keep the cached account and the device's copy.
            setUser(session.user)
          }
        }
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [commit])

  const adopt = useCallback(
    async (session: StoredSession) => {
      const remote = await pullAll(session.token)
      const merged = mergeRemote(dataRef.current, remote)
      writeSession(session)
      commit(merged)
      setUser(session.user)
      await db.importAll(merged)
      background(pushAll(session.token, merged))
    },
    [commit],
  )

  const signIn = useCallback(
    async (email: string, password: string) => {
      await adopt(await loginAccount(email, password))
    },
    [adopt],
  )

  const signUp = useCallback(
    async (email: string, password: string) => {
      await adopt(await registerAccount(email, password))
    },
    [adopt],
  )

  const signOut = useCallback(async () => {
    const token = sessionToken()
    writeSession(null)
    setUser(null)
    const cleared = emptyData()
    commit(cleared)
    await db.clearAll()
    // Revoke the session server-side, but never block the UI on it.
    if (token) background(logoutAccount(token))
  }, [commit])

  const saveProfile = useCallback(
    async (profile: Profile | null) => {
      commit({ ...dataRef.current, profile })
      await db.saveProfile(profile)
      const token = sessionToken()
      if (token) background(pushProfileRemote(token, profile))
    },
    [commit],
  )

  const upsertMeal = useCallback(
    async (meal: MealEntry) => {
      const prev = dataRef.current
      const idx = prev.meals.findIndex((m) => m.id === meal.id)
      const meals = idx >= 0 ? prev.meals.map((m) => (m.id === meal.id ? meal : m)) : [...prev.meals, meal]
      commit({ ...prev, meals })
      await db.putMeal(meal)
      const token = sessionToken()
      if (token) background(pushMeal(token, meal))
    },
    [commit],
  )

  const removeMeal = useCallback(
    async (id: string) => {
      const prev = dataRef.current
      commit({ ...prev, meals: prev.meals.filter((m) => m.id !== id) })
      await db.deleteMeal(id)
      const token = sessionToken()
      if (token) background(deleteMealRemote(token, id))
    },
    [commit],
  )

  const upsertFood = useCallback(
    async (food: Food) => {
      const prev = dataRef.current
      const idx = prev.foods.findIndex((f) => f.id === food.id)
      const foods = idx >= 0 ? prev.foods.map((f) => (f.id === food.id ? food : f)) : [...prev.foods, food]
      commit({ ...prev, foods })
      await db.putFood(food)
      const token = sessionToken()
      if (token) background(pushFood(token, food))
    },
    [commit],
  )

  const removeFood = useCallback(
    async (id: string) => {
      const prev = dataRef.current
      commit({ ...prev, foods: prev.foods.filter((f) => f.id !== id) })
      await db.deleteFood(id)
      const token = sessionToken()
      if (token) background(deleteFoodRemote(token, id))
    },
    [commit],
  )

  const logWeight = useCallback(
    async (kg: number, date: string = todayKey()) => {
      const prev = dataRef.current
      const others = prev.settings.weightLog.filter((w) => w.date !== date)
      const settings: Settings = { weightLog: [...others, { date, kg }] }
      const profile = prev.profile ? { ...prev.profile, weightKg: kg } : prev.profile
      commit({ ...prev, settings, profile })
      await db.saveSettings(settings)
      if (profile) await db.saveProfile(profile)
      const token = sessionToken()
      if (token) {
        background(pushSettingsRemote(token, settings))
        if (profile) background(pushProfileRemote(token, profile))
      }
    },
    [commit],
  )

  const importData = useCallback(
    async (next: AppData) => {
      commit(next)
      await db.importAll(next)
      const token = sessionToken()
      if (token) background(pushAll(token, next))
    },
    [commit],
  )

  const resetAll = useCallback(async () => {
    const cleared = emptyData()
    commit(cleared)
    await db.clearAll()
    const token = sessionToken()
    if (token) background(pushAll(token, cleared))
  }, [commit])

  const value = useMemo<AppContextValue>(
    () => ({
      ...data,
      ready,
      user,
      storageMode: mode,
      signIn,
      signUp,
      signOut,
      saveProfile,
      upsertMeal,
      removeMeal,
      upsertFood,
      removeFood,
      logWeight,
      importData,
      resetAll,
    }),
    [
      data,
      ready,
      user,
      mode,
      signIn,
      signUp,
      signOut,
      saveProfile,
      upsertMeal,
      removeMeal,
      upsertFood,
      removeFood,
      logWeight,
      importData,
      resetAll,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
