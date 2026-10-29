/** Local-date helpers. All day buckets are keyed by YYYY-MM-DD in device time. */

export const toKey = (d: Date): string => {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const todayKey = (): string => toKey(new Date())

export const keyToDate = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export const shiftKey = (key: string, days: number): string => {
  const d = keyToDate(key)
  d.setDate(d.getDate() + days)
  return toKey(d)
}

export const lastNDays = (n: number, endKey: string = todayKey()): string[] =>
  Array.from({ length: n }, (_, i) => shiftKey(endKey, -(n - 1 - i)))

/** "Mon 21 Oct" style label. */
export const formatDayLabel = (key: string, opts?: Intl.DateTimeFormatOptions): string =>
  keyToDate(key).toLocaleDateString(undefined, opts ?? { weekday: 'short', day: 'numeric', month: 'short' })

export const formatDayName = (key: string): string => {
  if (key === todayKey()) return 'Today'
  if (key === shiftKey(todayKey(), -1)) return 'Yesterday'
  return keyToDate(key).toLocaleDateString(undefined, { weekday: 'long' })
}

export const nowTime = (d: Date = new Date()): string =>
  `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`

export const makeId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
