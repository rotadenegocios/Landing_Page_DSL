import { handleCapi } from './_lib/tracking/capi-handler.js'

export default async function handler(request, response) {
  return handleCapi(request, response)
}
