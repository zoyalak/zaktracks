/**
 * ZakTracks API Worker.
 *
 * Serves the two vision endpoints (meal photo → structured nutrition,
 * nutrition label photo → structured food) and lets the SPA handle the rest.
 * The AI keys live here, server-side, and never reach the browser.
 *
 * Two legs: the primary is Qwen3.8 27B on Groq; when it fails the
 * fallback is Nemotron 3.5 Super VL (free) via OpenRouter.
 */

interface Env {
  OPENROUTER_API_KEY?: string
  GROQ_API_KEY?: string
  AI_MODEL?: string
  AI_FALLBACK_MODEL?: string
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

// Primary is Groq's Qwen3.8 27B; when that leg fails (rate limit, capacity,
// outage) the loop below falls through to the free Nemotron VL endpoint on
// OpenRouter. AI_MODEL / AI_FALLBACK_MODEL override either slot.
const PRIMARY_MODEL = 'qwen/qwen3.8-27b'
const FALLBACK_MODEL = 'nvidia/nemotron-3.5-super-vl:free'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

const errorBody = (message: string, code: string) => ({ error: message, code })

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MACRO_PROPS = {
  kcal: { type: 'NUMBER' },
  protein: { type: 'NUMBER' },
  carbs: { type: 'NUMBER' },
  fat: { type: 'NUMBER' },
}

// The macros beyond protein/carbs/fat. Grams except sodium/potassium/calcium/
// iron, which are milligrams.
const EXTRA_PROPS = {
  fiber: { type: 'NUMBER', nullable: true },
  sugar: { type: 'NUMBER', nullable: true },
  saturatedFat: { type: 'NUMBER', nullable: true },
  sodium: { type: 'NUMBER', nullable: true },
  potassium: { type: 'NUMBER', nullable: true },
  calcium: { type: 'NUMBER', nullable: true },
  iron: { type: 'NUMBER', nullable: true },
}

const EXTRA_KEYS = ['fiber', 'sugar', 'saturatedFat', 'sodium', 'potassium', 'calcium', 'iron']

// The extended macros as a nested `extras` object — what the parsers read
// back off each item / label.
const EXTRA_OBJECT = {
  type: 'OBJECT',
  properties: EXTRA_PROPS,
  required: [...EXTRA_KEYS],
  propertyOrdering: [...EXTRA_KEYS],
}

const readExtras = (v: unknown): Record<string, number> => {
  const o = (v ?? {}) as Record<string, unknown>
  // Accept either shape: a nested `{ extras: { … } }` object, or the seven
  // fields sitting flat on the parent. Models return both depending on how
  // they read the schema, and ignoring one silently zeroed every value.
  const nested = (o.extras ?? {}) as Record<string, unknown>
  return Object.fromEntries(EXTRA_KEYS.map((k) => [k, num(nested[k] ?? o[k])]))
}

const MEAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mealName: { type: 'STRING' },
    description: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    warnings: { type: 'ARRAY', items: { type: 'STRING' } },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantityText: { type: 'STRING' },
          grams: { type: 'NUMBER', nullable: true },
          ...MACRO_PROPS,
          extras: EXTRA_OBJECT,
        },
        required: ['name', 'kcal', 'protein', 'carbs', 'fat', 'extras'],
        propertyOrdering: [
          'name',
          'quantityText',
          'grams',
          'kcal',
          'protein',
          'carbs',
          'fat',
          'extras',
        ],
      },
    },
  },
  required: ['mealName', 'description', 'confidence', 'items'],
  propertyOrdering: ['mealName', 'description', 'confidence', 'warnings', 'items'],
}

const LABEL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    brand: { type: 'STRING' },
    per: { type: 'STRING', enum: ['100g', 'serving'] },
    servingLabel: { type: 'STRING' },
    gramsPerServing: { type: 'NUMBER', nullable: true },
    ...MACRO_PROPS,
    extras: EXTRA_OBJECT,
    notes: { type: 'STRING' },
  },
  required: ['name', 'per', 'kcal', 'protein', 'carbs', 'fat', 'extras', 'notes'],
  propertyOrdering: [
    'name',
    'brand',
    'per',
    'servingLabel',
    'gramsPerServing',
    'kcal',
    'protein',
    'carbs',
    'fat',
    'extras',
    'notes',
  ],
}

const GOALS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    ...Object.fromEntries(EXTRA_KEYS.map((k) => [k, { type: 'NUMBER' }])),
    rationale: { type: 'STRING' },
  },
  required: [...EXTRA_KEYS, 'protein', 'carbs', 'fat', 'rationale'],
  propertyOrdering: ['protein', 'carbs', 'fat', ...EXTRA_KEYS, 'rationale'],
}

const CHAT_SCHEMA = {
  type: 'OBJECT',
  properties: { reply: { type: 'STRING' } },
  required: ['reply'],
  propertyOrdering: ['reply'],
}

const CHAT_PROMPT = `You are ZakTracks, a friendly nutrition coach living inside the user's calorie-tracking app.

The app sends you today's live numbers: the calorie goal, how much has been eaten, what is left, the macro targets, and progress against them. Use them — they are the source of truth.

Rules:
- When the user lists ingredients they have at home, suggest 2-4 realistic meals they can actually cook mostly from those ingredients, choosing portions so each dish fits what they have LEFT today. For every dish give one line: name, portion, and approximate kcal / protein / carbs / fat per serving.
- If their calorie budget for the day is already nearly spent, say so briefly and suggest light options; if plenty remains, heartier ones.
- Keep it short: at most 2 sentences of intro, then one line per dish. Plain text only — no markdown tables, no asterisks, no headers.
- Practical home cooking only; no specialty equipment; be honest that macro numbers are estimates.
- Never invent app numbers you were not given, and never claim something was logged when it was not.
- Off-topic questions: answer briefly in one sentence and steer back to food or goals gently.`

const MEAL_PROMPT = `You are a precise nutrition analyst looking at a photo of someone's meal.

Identify every distinct food in the image and estimate its portion.

Rules:
- kcal/protein/carbs/fat must be for THE PORTION SHOWN, not per 100 g.
- protein, carbs and fat are in grams.
- Estimate portion weight in grams for each item ("grams"). Use the plate, cutlery and typical serving sizes as reference. If you truly cannot judge, use null.
- "quantityText" is a short human phrase like "1 cup", "2 slices", "about 150 g".
- Split mixed dishes into their real components when you can (e.g. rice, chicken, sauce, oil). If you cannot, keep it as one item with an honest estimate.
- Cooking method matters: fried, battered, creamy and sauced food carries far more fat than grilled or steamed.
- Be realistic rather than optimistic: visible oil, butter, dressing, cheese and sugar syrup all add calories.
- "description" is 2-4 plain sentences describing what you see and how you estimated it.
- "warnings" lists anything uncertain (hidden oil, unclear portion, unknown sauce).
- "confidence" is high when the dish is obvious and portions are clear, low when much is hidden or ambiguous.
- For every item also estimate "fiber", "sugar" and "saturatedFat" in grams, and "sodium", "potassium", "calcium" and "iron" in milligrams, for THE PORTION SHOWN. Use typical nutrition-table values for the foods you identified. Always return real estimates — never null, never 0 unless the food genuinely contains none of that nutrient.`

const LABEL_PROMPT = `You are a precise nutrition analyst reading a photo of a food's nutrition label or packaging.

Rules:
- Read the numbers exactly as printed. Do not invent values.
- Decide whether the panel reports values per 100 g/ml or per serving. Prefer per 100 g when both are shown.
- "per" must be "100g" or "serving" to match what you read.
- When values are per serving, copy the serving size into "servingLabel" (e.g. "1 cup (240 ml)") and put its numeric grams or ml into "gramsPerServing".
- "gramsPerServing" must be null when values are per 100 g or when no serving weight is printed.
- "name" is the product name from the package, "brand" the manufacturer if visible.
- "notes" briefly states what you read and flags anything blurry, cut off or guessed.
- If the label prints extended values (fibre/fiber, sugars, saturated fat, sodium, potassium, calcium, iron), copy them into the matching fields with the same per-100 g or per-serving basis as the rest. Use null for anything the label does not print — do not guess.
- If the label is unreadable, return empty strings for name/brand/notes explaining why, and 0 for every number.`

const GOALS_PROMPT = `You are a registered dietitian setting daily nutrition goals for one person.

You will be given their body stats, activity level, goal (maintain / cut / bulk), the weight they want to reach and over how many weeks, plus the daily calorie target that already accounts for that pace. Your job is to decide how those calories should split into macros, plus sensible daily targets for the extra macros.

Rules:
- protein, carbs and fat are GRAMS per day and their calories (4/4/9) must sum to roughly the given calorie target (within 3%).
- Prioritize adequate protein for the goal: higher while cutting, moderate while bulking.
- fiber is a daily TARGET in grams (typical healthy range 25-40 g).
- sugar is a sensible daily UPPER LIMIT in grams.
- saturatedFat is a daily UPPER LIMIT in grams.
- sodium is an daily UPPER LIMIT in milligrams (heart-healthy, typically under 2300 mg).
- potassium, calcium and iron are daily TARGETS in milligrams, matched to the person's sex and life stage.
- Adjust everything to the goal: cutting needs protein sparing and lower calorie density; bulking needs carbs to fuel training and surplus.
- "rationale" is 2-3 plain sentences explaining the choices for this person.`

// ---------------------------------------------------------------------------
// AI providers — Groq primary, OpenRouter fallback (both OpenAI-style)
// ---------------------------------------------------------------------------

interface Part {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

interface ModelCall {
  text: string
  model: string
}

function parseDataUrl(image: string): { mime: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(image.trim())
  if (match) return { mime: match[1], data: match[2] }
  if (/^[A-Za-z0-9+/=\s]+$/.test(image.trim())) return { mime: 'image/jpeg', data: image.replace(/\s+/g, '') }
  return null
}

/** Normalized result of one provider hop. status 0 = network failure. */
interface AttemptResult {
  ok: boolean
  status: number
  detail: string
  text: string
}

/** One hop: OpenRouter chat/completions (OpenAI-style protocol) — the fallback leg. */
async function callOpenRouter(
  key: string,
  model: string,
  parts: Part[],
  schema: unknown,
  prompt: string,
): Promise<AttemptResult> {
  // OpenAI-style chat content from the Gemini-style parts.
  const content = parts.map((p) =>
    p.inline_data
      ? { type: 'image_url', image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } }
      : { type: 'text', text: p.text ?? '' },
  )
  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        // Attribution headers OpenRouter recommends for apps.
        'http-referer': 'https://zaktracks.freebuff.page',
        'x-title': 'ZakTracks',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 4096,
        // json_object is the most portable structured-output mode across
        // OpenRouter routes; the exact shape is spelled out in the prompt.
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${prompt}\n\nReturn a single JSON object matching this shape, and nothing else:\n${JSON.stringify(schema)}`,
          },
          { role: 'user', content },
        ],
      }),
    })
  } catch (err) {
    return { ok: false, status: 0, detail: `network error — ${(err as Error).message}`, text: '' }
  }
  const detail = await res.text().catch(() => '')
  if (!res.ok) return { ok: false, status: res.status, detail, text: '' }
  try {
    const data = JSON.parse(detail) as { choices?: { message?: { content?: string } }[] }
    return { ok: true, status: 200, detail, text: data.choices?.[0]?.message?.content?.trim() ?? '' }
  } catch {
    return { ok: false, status: 502, detail: 'invalid JSON in provider response', text: '' }
  }
}

/** One hop: Groq's OpenAI-compatible API — the primary leg. */
async function callGroq(
  key: string,
  model: string,
  parts: Part[],
  schema: unknown,
  prompt: string,
): Promise<AttemptResult> {
  let res: Response
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 4096,
        // Groq's JSON mode: the exact shape is spelled out in the prompt.
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `${prompt}\n\nReturn a single JSON object matching this shape, and nothing else:\n${JSON.stringify(schema)}`,
          },
          {
            role: 'user',
            content: parts.map((p) =>
              p.inline_data
                ? { type: 'image_url', image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` } }
                : { type: 'text', text: p.text ?? '' },
            ),
          },
        ],
      }),
    })
  } catch (err) {
    return { ok: false, status: 0, detail: `network error — ${(err as Error).message}`, text: '' }
  }
  const detail = await res.text().catch(() => '')
  if (!res.ok) return { ok: false, status: res.status, detail, text: '' }
  try {
    const data = JSON.parse(detail) as { choices?: { message?: { content?: string } }[] }
    return {
      ok: true,
      status: 200,
      detail,
      text: data.choices?.[0]?.message?.content?.trim() ?? '',
    }
  } catch {
    return { ok: false, status: 502, detail: 'invalid JSON in provider response', text: '' }
  }
}

async function callModel(
  env: Env,
  parts: Part[],
  schema: unknown,
  prompt: string,
): Promise<ModelCall> {
  const orKey = env.OPENROUTER_API_KEY
  const groqKey = env.GROQ_API_KEY
  if (!orKey && !groqKey) {
    const err = new Error(
      'AI analysis needs a Groq or OpenRouter API key configured on the server.',
    ) as Error & { status: number; code: string }
    err.status = 503
    err.code = 'NO_API_KEY'
    throw err
  }

  // The chain: Groq's Qwen3.8 27B first, then the free Nemotron endpoint on
  // OpenRouter when the primary leg fails.
  const chain: { label: string; provider: string; run: () => Promise<AttemptResult> }[] = []
  if (groqKey) {
    const model = env.AI_MODEL || PRIMARY_MODEL
    chain.push({
      label: model,
      provider: 'Groq',
      run: () => callGroq(groqKey, model, parts, schema, prompt),
    })
  }
  if (orKey) {
    const model = env.AI_FALLBACK_MODEL || FALLBACK_MODEL
    chain.push({
      label: model,
      provider: 'OpenRouter',
      run: () => callOpenRouter(orKey, model, parts, schema, prompt),
    })
  }

  const failures: string[] = []
  let quotaMisses = 0
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  for (const entry of chain) {
    // Keep retries lean: the legs have small request budgets, so a failing
    // call must not burn the whole day on retries.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await entry.run()

      if (result.ok) {
        if (!result.text) {
          const err = new Error('The model returned no usable data (empty response).') as Error & {
            status: number
            code: string
          }
          err.status = 502
          err.code = 'EMPTY_RESPONSE'
          throw err
        }
        return { text: result.text, model: entry.label }
      }

      if (result.status === 401 || result.status === 403) {
        const err = new Error(
          `The ${entry.provider} API key was rejected by the provider. Check the key on the server.`,
        ) as Error & { status: number; code: string }
        err.status = 401
        err.code = 'INVALID_KEY'
        throw err
      }
      if (result.status === 429) {
        // Rate limit for this leg — record it and fall through to the next
        // (e.g. Groq rate limited → Nemotron takes over).
        quotaMisses += 1
        failures.push(`${entry.label}: rate limited (HTTP 429)`)
        break
      }
      if (result.status === 402) {
        // No OpenRouter credits left for a paid route — try the next one.
        failures.push(`${entry.label}: out of OpenRouter credits (HTTP 402)`)
        break
      }
      // Transient upstream trouble (network blips, 5xx, and 404s which
      // providers serve during capacity incidents) — back off and retry.
      if ((result.status >= 500 || result.status === 404 || result.status === 0) && attempt < 1) {
        await sleep(700 * (attempt + 1))
        continue
      }
      // Unknown model / unsupported param / other — record it, try the next.
      failures.push(`${entry.label}: HTTP ${result.status} — ${result.detail.slice(0, 180)}`)
      break
    }
  }

  // Only surface a quota error when every leg was rate limited; anything
  // else is an upstream failure with the details attached.
  if (quotaMisses >= chain.length) {
    const err = new Error(
      'The AI service is rate limited right now — the free models are out of capacity. Try again in a few minutes.',
    ) as Error & { status: number; code: string }
    err.status = 429
    err.code = 'RATE_LIMITED'
    throw err
  }

  const err = new Error(
    failures.join(' | ') || 'The AI service is unavailable right now.',
  ) as Error & { status: number; code: string }
  err.status = 502
  err.code = 'UPSTREAM'
  throw err
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0
}

const nullableNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v.trim().slice(0, 400) : fallback

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function readImageBody(request: Request): Promise<{ image: string; hint: string }> {
  let body: { image?: unknown; hint?: unknown; nameHint?: unknown }
  try {
    body = await request.json()
  } catch {
    const err = new Error('Expected a JSON body.') as Error & { status: number; code: string }
    err.status = 400
    err.code = 'BAD_REQUEST'
    throw err
  }
  const image = typeof body.image === 'string' ? body.image : ''
  const hint = str(body.hint ?? body.nameHint)
  // Text-only analysis ("describe your meal") is allowed; an image is not mandatory.
  if (!image && !hint) {
    const err = new Error('No image or description was provided.') as Error & {
      status: number
      code: string
    }
    err.status = 400
    err.code = 'BAD_REQUEST'
    throw err
  }
  const approxBytes = Math.round(image.length * 0.75)
  if (approxBytes > MAX_IMAGE_BYTES) {
    const err = new Error('That photo is too large. Try a smaller or more cropped shot.') as Error & {
      status: number
      code: string
    }
    err.status = 413
    err.code = 'TOO_LARGE'
    throw err
  }
  return { image, hint }
}

async function handleMeal(request: Request, env: Env): Promise<Response> {
  const { image, hint } = await readImageBody(request)
  const parsed = image ? parseDataUrl(image) : null
  if (image && !parsed) {
    return json(errorBody('That image could not be decoded.', 'BAD_IMAGE'), 400)
  }
  const parts: Part[] = []
  if (hint) parts.push({ text: `The user says the meal contains: ${hint}` })
  if (parsed) parts.push({ inline_data: { mime_type: parsed.mime, data: parsed.data } })

  const { text, model } = await callModel(env, parts, MEAL_SCHEMA, MEAL_PROMPT)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return json(errorBody('The analysis came back in an unexpected format.', 'PARSE'), 502)
  }
  const o = raw as Record<string, unknown>
  const items = Array.isArray(o.items)
    ? o.items.slice(0, 30).map((i) => {
        const item = (i ?? {}) as Record<string, unknown>
        return {
          name: str(item.name, 'Food'),
          quantityText: str(item.quantityText),
          grams: nullableNum(item.grams),
          kcal: num(item.kcal),
          protein: num(item.protein),
          carbs: num(item.carbs),
          fat: num(item.fat),
          extras: readExtras(item),
        }
      })
    : []

  return json({
    mealName: str(o.mealName, 'Meal'),
    description: str(o.description),
    confidence: ['high', 'medium', 'low'].includes(String(o.confidence))
      ? String(o.confidence)
      : 'medium',
    warnings: Array.isArray(o.warnings) ? o.warnings.map((w) => str(w)).filter(Boolean).slice(0, 6) : [],
    items,
    model,
  })
}

async function handleLabel(request: Request, env: Env): Promise<Response> {
  const { image, hint } = await readImageBody(request)
  const parsed = parseDataUrl(image)
  if (!parsed) {
    return json(errorBody('That image could not be decoded.', 'BAD_IMAGE'), 400)
  }
  const parts: Part[] = []
  if (hint) parts.push({ text: `The product is called: ${hint}` })
  parts.push({ inline_data: { mime_type: parsed.mime, data: parsed.data } })

  const { text, model } = await callModel(env, parts, LABEL_SCHEMA, LABEL_PROMPT)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return json(errorBody('The analysis came back in an unexpected format.', 'PARSE'), 502)
  }
  const o = raw as Record<string, unknown>
  const per = o.per === 'serving' ? 'serving' : '100g'

  return json({
    name: str(o.name),
    brand: str(o.brand),
    per,
    servingLabel: str(o.servingLabel),
    gramsPerServing: per === 'serving' ? nullableNum(o.gramsPerServing) : null,
    kcal: num(o.kcal),
    protein: num(o.protein),
    carbs: num(o.carbs),
    fat: num(o.fat),
    extras: readExtras(o),
    notes: str(o.notes),
    model,
  })
}

const ACTIVITY_WORDS: Record<string, string> = {
  sedentary: 'sedentary (desk job, little exercise)',
  light: 'lightly active (exercise 1-3 days/week)',
  moderate: 'moderately active (exercise 3-5 days/week)',
  active: 'very active (hard training 6-7 days/week)',
  very_active: 'athlete (twice-daily training or physical job)',
}

async function handleGoals(request: Request, env: Env): Promise<Response> {
  let body: { profile?: Record<string, unknown>; goalKcal?: unknown }
  try {
    body = await request.json()
  } catch {
    const err = new Error('Expected a JSON body.') as Error & { status: number; code: string }
    err.status = 400
    err.code = 'BAD_REQUEST'
    throw err
  }
  const p = body.profile ?? {}
  const goalKcal = num(body.goalKcal)
  if (goalKcal < 800) {
    const err = new Error('A calorie target is required to generate goals.') as Error & {
      status: number
      code: string
    }
    err.status = 400
    err.code = 'BAD_REQUEST'
    throw err
  }
  const sex = p.sex === 'female' || p.sex === 'male' ? p.sex : 'undisclosed'
  const goal = p.goal === 'cut' || p.goal === 'bulk' ? p.goal : 'maintain'
  const activity = String(p.activity ?? 'moderate')
  const profileText = [
    `sex: ${sex}`,
    `age: ${num(p.age) || 30} years`,
    `height: ${num(p.heightCm) || 170} cm`,
    `weight: ${num(p.weightKg) || 70} kg`,
    `activity: ${ACTIVITY_WORDS[activity] ?? activity}`,
    `goal: ${goal}`,
    goal === 'maintain'
      ? 'target: maintain current weight'
      : `target weight: ${num(p.targetWeightKg) || num(p.weightKg)} kg within ${num(p.weeks) || 12} weeks`,
    `daily calorie target for that pace: ${goalKcal} kcal`,
  ].join(', ')

  const { text, model } = await callModel(
    env,
    [{ text: `Profile: ${profileText}` }],
    GOALS_SCHEMA,
    GOALS_PROMPT,
  )
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return json(errorBody('The goals came back in an unexpected format.', 'PARSE'), 502)
  }
  const o = raw as Record<string, unknown>

  return json({
    protein: num(o.protein),
    carbs: num(o.carbs),
    fat: num(o.fat),
    extras: readExtras(o),
    rationale: str(o.rationale),
    model,
  })
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  let body: { message?: unknown; history?: unknown; context?: unknown }
  try {
    body = await request.json()
  } catch {
    const err = new Error('Expected a JSON body.') as Error & { status: number; code: string }
    err.status = 400
    err.code = 'BAD_REQUEST'
    throw err
  }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : ''
  if (!message) {
    const err = new Error('A message is required.') as Error & { status: number; code: string }
    err.status = 400
    err.code = 'BAD_REQUEST'
    throw err
  }
  const context = typeof body.context === 'string' ? body.context.slice(0, 2500) : ''
  const history = Array.isArray(body.history)
    ? body.history.slice(-12).map((h) => {
        const m = (h ?? {}) as Record<string, unknown>
        const role = m.role === 'assistant' ? 'Coach' : 'User'
        return `${role}: ${str(m.text).slice(0, 600)}`
      })
    : []

  const parts: string[] = []
  if (context) parts.push(`Today's numbers from the app:\n${context}`)
  if (history.length) parts.push(`Earlier conversation:\n${history.join('\n')}`)
  parts.push(`User's latest message: ${message}`)

  const { text, model } = await callModel(env, [{ text: parts.join('\n\n') }], CHAT_SCHEMA, CHAT_PROMPT)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return json(errorBody('The reply came back in an unexpected format.', 'PARSE'), 502)
  }
  const reply = str((raw as Record<string, unknown>).reply)
  if (!reply) return json(errorBody('The coach had nothing to say — try again.', 'PARSE'), 502)
  return json({ reply, model })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path.startsWith('/api/')) {
      const headers: Record<string, string> = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

      try {
        if (path === '/api/health' && request.method === 'GET') {
          return json({
            ok: true,
            hasKey: Boolean(env.OPENROUTER_API_KEY || env.GROQ_API_KEY),
            model: env.AI_MODEL || PRIMARY_MODEL,
            fallback: env.AI_FALLBACK_MODEL || FALLBACK_MODEL,
          })
        }
        if (path === '/api/analyze/meal' && request.method === 'POST') {
          return await handleMeal(request, env)
        }
        if (path === '/api/analyze/label' && request.method === 'POST') {
          return await handleLabel(request, env)
        }
        if (path === '/api/goals' && request.method === 'POST') {
          return await handleGoals(request, env)
        }
        if (path === '/api/chat' && request.method === 'POST') {
          return await handleChat(request, env)
        }
        return json(errorBody('Not found.', 'NOT_FOUND'), 404)
      } catch (err) {
        const e = err as Error & { status?: number; code?: string }
        const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500
        return json(errorBody(e.message || 'Unexpected error.', e.code ?? 'INTERNAL'), status)
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }
    return new Response('Not found', { status: 404 })
  },
}
