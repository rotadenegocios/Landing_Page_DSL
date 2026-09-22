import { createHash } from 'node:crypto'

const GRAPH_VERSION = 'v21.0'
const TIMEOUT_MS = 5000

const META_EVENT_NAMES = {
  page_view: 'PageView',
  scroll_depth: 'PageScroll',
  view_item: 'ViewContent',
  cta_click: 'CTAClick',
  generate_lead: 'Lead',
}

function hash(value) {
  if (!value) return undefined
  return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex')
}

function hashPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return undefined
  return createHash('sha256').update(digits).digest('hex')
}

function hashId(value, salt) {
  if (!value) return undefined
  return createHash('sha256').update(`${salt}:${value}`).digest('hex')
}

function pickCustomData(params = {}) {
  const allowed = [
    'content_ids',
    'content_name',
    'content_type',
    'cta_source',
    'item_id',
    'item_name',
    'percent_scrolled',
    'site_id',
    'time_to_reach_ms',
    'variante',
  ]

  return Object.fromEntries(
    Object.entries(params).filter(([key, value]) => allowed.includes(key) && value !== undefined),
  )
}

export function metaEventName(name) {
  return META_EVENT_NAMES[name]
}

function list(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

// Um ou mais datasets. Um unico token vale para todos; se houver mais de um
// token, a ordem acompanha a dos datasets.
export async function sendMetaEvent({ event, clientIp, userAgent }) {
  const datasetIds = list(process.env.META_DATASET_ID)
  const tokens = list(process.env.META_CAPI_ACCESS_TOKEN)
  const testEventCodes = list(process.env.META_TEST_EVENT_CODE)

  if (!datasetIds.length || !tokens.length) return { skipped: 'sem_credenciais' }
  if (testEventCodes.length && testEventCodes.length !== datasetIds.length) {
    return { skipped: 'codigo_de_teste_incompativel' }
  }

  const eventName = metaEventName(event.event_name)
  if (!eventName) return { skipped: 'evento_nao_mapeado' }

  const salt = process.env.TRACKING_SALT || ''
  const userData = event.user_data || {}

  // O mesmo event_id vai para todos os datasets: a deduplicacao da Meta e por
  // dataset, entao repetir o id nao mistura as contagens.
  const eventPayload = {
    event_name: eventName,
    event_time: event.event_time || Math.floor(Date.now() / 1000),
    event_id: event.event_id,
    event_source_url: event.event_source_url,
    action_source: 'website',
    user_data: {
      em: hash(userData.email),
      ph: hashPhone(userData.phone),
      external_id: hashId(event.user_id, salt),
      fbp: userData.fbp || undefined,
      fbc: userData.fbc || undefined,
      client_ip_address: clientIp || undefined,
      client_user_agent: userAgent || undefined,
    },
    custom_data: pickCustomData(event.params),
  }

  const results = await Promise.all(
    datasetIds.map((datasetId, index) =>
      postToDataset({
        datasetId,
        token: tokens[index] || tokens[0],
        eventPayload,
        testEventCode: testEventCodes[index],
      }),
    ),
  )

  const failed = results.filter((result) => result.error)
  return failed.length ? { error: failed[0].error, sent: results.length - failed.length } : { ok: true }
}

async function postToDataset({ datasetId, token, eventPayload, testEventCode }) {
  const payload = {
    access_token: token,
    data: [eventPayload],
    ...(testEventCode
      ? { test_event_code: testEventCode }
      : {}),
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // O token vai no corpo, nao na URL: querystring aparece em log de acesso.
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${datasetId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) return { error: `meta_${response.status}` }
    return { ok: true }
  } catch {
    return { error: 'meta_indisponivel' }
  } finally {
    clearTimeout(timeout)
  }
}
