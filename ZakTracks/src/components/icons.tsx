import type { CSSProperties, ReactNode } from 'react'

/**
 * The app's own icon set: hand-drawn line icons in the accent's stroke weight.
 * Every screen uses these instead of emoji, so the UI looks the same on every
 * phone rather than depending on the system's emoji font.
 */
export type IconName =
  | 'track'
  | 'activity'
  | 'foods'
  | 'logs'
  | 'chat'
  | 'profile'
  | 'search'
  | 'camera'
  | 'image'
  | 'sparkle'
  | 'pencil'
  | 'list'
  | 'tag'
  | 'download'
  | 'upload'
  | 'phone'
  | 'alert'
  | 'info'
  | 'close'
  | 'scale'
  | 'flame'
  | 'dumbbell'
  | 'chair'
  | 'walk'
  | 'run'
  | 'medal'
  | 'plate'
  | 'bowl'
  | 'mic'

const PATHS: Record<IconName, ReactNode> = {
  /* ------------------------------------------------------------- the tabs */
  track: (
    <>
      <path d="M6 2v4.5a2 2 0 0 0 4 0V2" />
      <path d="M8 8.5V22" />
      <path d="M17 2v20" />
      <path d="M17 2c2 1.5 2.6 3.4 2.6 5.5S19 13 17 14.5" />
    </>
  ),
  activity: <path d="M2.5 12h4l3 8 4-16 3 8h5" />,
  foods: (
    <>
      <path d="M6 3 3.5 7.5V20A1.5 1.5 0 0 0 5 21.5h14a1.5 1.5 0 0 0 1.5-1.5V7.5L18 3z" />
      <path d="M3.5 7.5h17" />
      <path d="M16 11a4 4 0 0 1-8 0" />
    </>
  ),
  logs: (
    <>
      <path d="M4 3v16a2 2 0 0 0 2 2h14" />
      <path d="m7.5 14.5 3.5-4 3 2.5 4.5-6" />
    </>
  ),
  chat: <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  profile: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),

  /* ---------------------------------------------------------- the actions */
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  camera: (
    <>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 15-4.5-4.5L5 20" />
    </>
  ),
  sparkle: (
    <>
      <path d="M11 3l1.7 4.8L17.5 9.5l-4.8 1.7L11 16l-1.7-4.8L4.5 9.5l4.8-1.7z" />
      <path d="M18 16v3.5M16.2 17.8h3.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  list: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2 2.6 18a1.8 1.8 0 0 0 1.6 2.7h15.6a1.8 1.8 0 0 0 1.6-2.7L13.7 4.2a1.8 1.8 0 0 0-3.4 0z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <path d="M9.5 18h5" />
      <path d="M10 21.5h4" />
      <path d="M12 2.5a6 6 0 0 0-3.5 10.9V17h7v-3.6A6 6 0 0 0 12 2.5z" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,

  /* ------------------------------------------------- goals and activity */
  scale: (
    <>
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M4 7h16" />
      <path d="m4 7-2.8 6.5a3.2 3.2 0 0 0 5.6 0z" />
      <path d="m20 7 2.8 6.5a3.2 3.2 0 0 1-5.6 0z" />
    </>
  ),
  flame: (
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  ),
  dumbbell: (
    <>
      <path d="M4 9v6M7 6.5v11M17 6.5v11M20 9v6" />
      <path d="M7 12h10" />
    </>
  ),
  chair: (
    <>
      <path d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
      <path d="M4 10h16v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M7 17v3M17 17v3" />
    </>
  ),
  walk: (
    <>
      <circle cx="13.5" cy="4.5" r="2" />
      <path d="M13.5 7v5l2.8 3 .7 5" />
      <path d="M13.5 12l-3 3.2V20" />
      <path d="M13.5 9l3.5 1.5" />
    </>
  ),
  run: (
    <>
      <circle cx="15.5" cy="4.5" r="2" />
      <path d="M15 7.5l-2 4.5 3 3 1 4.5" />
      <path d="M13 12l-4.5 1.5L7 18" />
      <path d="M15 8.5l3.5 1.5" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15.5" r="5.5" />
      <path d="M8.7 10.4 6 3h12l-2.7 7.4" />
      <path d="m12 13 1 1.9 2 .3-1.4 1.5.3 2-1.9-1-1.9 1 .3-2L9 15.2l2-.3z" />
    </>
  ),

  /* ------------------------------------------------------------- meals */
  plate: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
    </>
  ),
  bowl: (
    <>
      <path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z" />
      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </>
  ),
}

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
