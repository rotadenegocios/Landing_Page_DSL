import { metaEventName, sendMetaEvent } from './meta.js'

const MAX_BODY_BYTES = 20000
const MAX_EVENTS = 40
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60000
const DEFAULT_ORIGIN_SUFFIXES = ['.vercel.app', 'gesieudo.com', 'localhost']
const rateBuckets = new Map()

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return request.socket?.remoteAddress || ''
}

function originAllowed(request) {
  const origin = request.headers.origin
  if (!origin) return true
  const configured = String(process.env.TRACKING_ALLOWED_ORIGINS || '')
    .split(',').map((item) => item.trim()).filter(Boolean)
  const allowed = configured.length ? configured : DEFAULT_ORIGIN_SUFFIXES
  try {
    const hostname = new URL(origin).hostname
    return allowed.some((suffix) => hostname === suffix || hostname.endsWith(suffix))
  } catch {
    return false
  }
}

function withinRateLimit(ip) {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  bucket.count += 1
  return bucket.count <= RATE_LIMIT
}

function done(response) {
  response.setHeader('Cache-Control', 'no-store')
  return response.status(204).end()
}

export async function handleCapi(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).end()
  }
  if (!originAllowed(request) || !withinRateLimit(clientIp(request))) return done(response)

  try {
    const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body || '')
    if (raw.length > MAX_BODY_BYTES) return done(response)
    const payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {}
    const incoming = Array.isArray(payload?.events) ? payload.events : [payload]
    const events = incoming
      .filter((event) => event?.channel === 'meta' && event?.consent?.ads === true && event.event_id && metaEventName(event.event_name))
      .slice(0, MAX_EVENTS)

    await Promise.all(events.map((event) => sendMetaEvent({
      event,
      clientIp: clientIp(request),
      userAgent: request.headers['user-agent'] || '',
    }).catch(() => undefined)))
  } catch {
    // Rastreamento nunca pode derrubar a pagina.
  }
  return done(response)
}
