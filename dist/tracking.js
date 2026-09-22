// Rastreamento de paginas que ainda nao usam o cliente completo do _shared.
// Nao contem segredos: IDs publicos vem do ambiente de build ou dos fallbacks oficiais.

const ADS_FALLBACK = 'AW-17812782806'
const GA4_FALLBACK = 'G-434Q7GE2NZ'
const GTM_FALLBACK = 'GTM-KGV7RZ42'
const PIXEL_FALLBACK = ['2074399583036288', '1336189881164076']

function value(env, names, fallback = '') {
  for (const name of names) {
    if (env?.[name] !== undefined && env[name] !== '') return String(env[name])
  }
  return fallback
}

function list(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function inject(src) {
  if (document.querySelector(`script[src="${src}"]`)) return
  const script = document.createElement('script')
  script.async = true
  script.src = src
  document.head.appendChild(script)
}

function ensureGtag(baseId) {
  window.dataLayer = window.dataLayer || []
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments)
  }
  if (baseId) inject(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(baseId)}`)
  window.gtag('js', new Date())
}

function loadGoogle(env) {
  const ga4Id = value(env, ['VITE_GA4_MEASUREMENT_ID', 'NEXT_PUBLIC_GA4_MEASUREMENT_ID', 'GA4_MEASUREMENT_ID'], GA4_FALLBACK)
  const adsId = value(env, ['VITE_GOOGLE_ADS_ID', 'NEXT_PUBLIC_GOOGLE_ADS_ID', 'GOOGLE_ADS_ID'], ADS_FALLBACK)
  ensureGtag(ga4Id || adsId)
  if (ga4Id) window.gtag('config', ga4Id, { send_page_view: false })
  if (adsId) window.gtag('config', adsId, { send_page_view: false })
}

function loadGtm(env) {
  const gtmId = value(env, ['VITE_GTM_ID', 'NEXT_PUBLIC_GTM_ID', 'GTM_ID'], GTM_FALLBACK)
  if (!gtmId) return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
  inject(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`)
}

function loadPixel(env) {
  const configured = list(value(env, ['VITE_META_PIXEL_ID', 'NEXT_PUBLIC_META_PIXEL_ID', 'META_PIXEL_ID']))
  const pixelIds = [...new Set([...configured, ...PIXEL_FALLBACK])]
  if (!pixelIds.length || window.fbq) return

  window.fbq = function fbq() {
    window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments)
  }
  window._fbq = window.fbq
  window.fbq.push = window.fbq
  window.fbq.loaded = true
  window.fbq.version = '2.0'
  window.fbq.queue = []
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  document.head.appendChild(script)
  pixelIds.forEach((id) => window.fbq('init', id))
}

function sendCapi(apiPath, siteId, eventName, params = {}, eventId) {
  const payload = {
    channel: 'meta',
    event_name: eventName,
    event_id: eventId || `lite_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: window.location.href,
    site_id: siteId,
    consent: { ads: true, analytics: true },
    params,
    user_data: {
      fbp: document.cookie.match(/(?:^|; )_fbp=([^;]+)/)?.[1] || undefined,
      fbc: document.cookie.match(/(?:^|; )_fbc=([^;]+)/)?.[1] || undefined,
    },
  }
  fetch(apiPath, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ events: [payload] }),
    keepalive: true,
  }).catch(() => {})
}

export function startStandaloneTracking(runtimeEnv = {}, options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  if (window.__rotaStandaloneTracking) return window.rotaTrack || (() => {})

  const enabled = value(runtimeEnv, ['VITE_TRACKING_ENABLED', 'NEXT_PUBLIC_TRACKING_ENABLED', 'TRACKING_ENABLED'], 'true') !== 'false'
  if (!enabled || window.localStorage.getItem('tracking_opt_out') === '1') return () => {}

  const siteId = options.siteId || value(runtimeEnv, ['VITE_SITE_ID', 'NEXT_PUBLIC_SITE_ID', 'SITE_ID'], window.location.hostname)
  const apiPath = options.apiPath || value(runtimeEnv, ['VITE_TRACKING_API_PATH', 'NEXT_PUBLIC_TRACKING_API_PATH'], '/api/track')
  window.__rotaStandaloneTracking = true

  loadGoogle(runtimeEnv)
  loadGtm(runtimeEnv)
  loadPixel(runtimeEnv)

  const track = (name, params = {}) => {
    const eventId = `standalone_${Date.now()}_${Math.random().toString(36).slice(2)}`
    window.gtag?.('event', name, { ...params, site_id: siteId })
    if (window.fbq) {
      const metaName = name === 'page_view'
        ? 'PageView'
        : name === 'scroll_depth'
          ? 'PageScroll'
          : name === 'view_item'
            ? 'ViewContent'
            : name === 'cta_click'
              ? 'CTAClick'
              : 'CustomEvent'
      const method = metaName === 'PageView' || metaName === 'ViewContent' ? 'track' : 'trackCustom'
      window.fbq(method, metaName, params, { eventID: eventId })
    }
    sendCapi(apiPath, siteId, name, params, eventId)
  }

  window.rotaTrack = track
  track('page_view', { page_path: window.location.pathname, page_location: window.location.href })
  track('view_item', { item_id: siteId, item_name: document.title, content_type: 'product' })

  const scrollMarks = new Set()
  const trackScrollDepth = () => {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight
    if (scrollableHeight <= 0) return
    const scrollPercent = Math.round((window.scrollY / scrollableHeight) * 100)
    for (const threshold of [25, 50, 75, 90]) {
      if (scrollPercent >= threshold && !scrollMarks.has(threshold)) {
        scrollMarks.add(threshold)
        track('scroll_depth', { scroll_percent: threshold, page_path: window.location.pathname })
      }
    }
  }
  window.addEventListener('scroll', trackScrollDepth, { passive: true })
  trackScrollDepth()

  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('a[href],button,[data-cta-source]')
    if (!target) return
    const href = target.href || ''
    const name = target.dataset.ctaSource || target.matches('a[href],button') ? 'cta_click' : ''
    if (!name) return
    track(name, {
      cta_source: target.dataset.ctaSource || undefined,
      link_url: href.slice(0, 400),
      cta_text: (target.innerText || '').trim().slice(0, 80),
    })
  }, true)

  return track
}
