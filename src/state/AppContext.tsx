import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AppData, Food, MealEntry, Profile, Settings } from '../lib/types'
import * as db from '../lib/db'
import { todayKey } from '../lib/date'

interface AppContextValue extends AppData {
  ready: boolean
  storageMode: 'indexeddb' | 'localstorage'
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<'indexeddb' | 'localstorage'>('indexeddb')

  useEffect(() => {
    let cancelled = false
    db.loadAll()
      .then((loaded) => {
        if (cancelled) return
        setData(loaded)
        setMode(db.storageMode())
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveProfile = useCallback(async (profile: Profile | null) => {
    setData((prev) => ({ ...prev, profile }))
    await db.saveProfile(profile)
  }, [])

  const upsertMeal = useCallback(async (meal: MealEntry) => {
    setData((prev) => {
      const idx = prev.meals.findIndex((m) => m.id === meal.id)
      const meals = idx >= 0 ? prev.meals.map((m) => (m.id === meal.id ? meal : m)) : [...prev.meals, meal]
      return { ...prev, meals }
    })
    await db.putMeal(meal)
  }, [])

  const removeMeal = useCallback(async (id: string) => {
    setData((prev) => ({ ...prev, meals: prev.meals.filter((m) => m.id !== id) }))
    await db.deleteMeal(id)
  }, [])

  const upsertFood = useCallback(async (food: Food) => {
    setData((prev) => {
      const idx = prev.foods.findIndex((f) => f.id === food.id)
      const foods = idx >= 0 ? prev.foods.map((f) => (f.id === food.id ? food : f)) : [...prev.foods, food]
      return { ...prev, foods }
    })
    await db.putFood(food)
  }, [])

  const removeFood = useCallback(async (id: string) => {
    setData((prev) => ({ ...prev, foods: prev.foods.filter((f) => f.id !== id) }))
    await db.deleteFood(id)
  }, [])

  const logWeight = useCallback(
    async (kg: number, date: string = todayKey()) => {
      setData((prev) => {
        const others = prev.settings.weightLog.filter((w) => w.date !== date)
        const settings: Settings = { weightLog: [...others, { date, kg }] }
        const profile = prev.profile
          ? { ...prev.profile, weightKg: kg }
          : prev.profile
        const next: AppData = { ...prev, settings, profile }
        void db.saveSettings(settings)
        if (next.profile) void db.saveProfile(next.profile)
        return next
      })
    },
    [],
  )

  const importData = useCallback(async (next: AppData) => {
    setData(next)
    await db.importAll(next)
  }, [])

  const resetAll = useCallback(async () => {
    const cleared = emptyData()
    setData(cleared)
    await db.clearAll()
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({
      ...data,
      ready,
      storageMode: mode,
      saveProfile,
      upsertMeal,
      removeMeal,
      upsertFood,
      removeFood,
      logWeight,
      importData,
      resetAll,
    }),
    [data, ready, mode, saveProfile, upsertMeal, removeMeal, upsertFood, removeFood, logWeight, importData, resetAll],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
