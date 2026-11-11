import { config } from './config.js'
import { decrypt } from './crypto.js'

export class AppError extends Error {}

// Calichef keeps the session in a `token` cookie (a JWT valid for 30 days), so the
// server sends it back as a cookie on every call.
async function send (path, { method = 'GET', body, session } = {}) {
  let response
  try {
    response = await fetch(`${config.appUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(session && { Cookie: `token=${session}` })
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    })
  } catch {
    throw new AppError('Calichef could not be reached. Try again in a moment.')
  }
  const json = await response.json().catch(() => null)
  return { status: response.status, ok: response.ok, json, headers: response.headers }
}

// A reply without the API's JSON means APP_URL points somewhere that is not Calichef.
const errorText = (json, status) =>
  json?.message ||
  json?.error ||
  `Calichef returned ${status} from ${new URL(config.appUrl).host}. Check that APP_URL is the Calichef app's URL.`

// Signs in on the user's behalf. Returns the Calichef session token and the user.
export async function login (email, password) {
  const { ok, status, json, headers } = await send('/api/auth/login', { method: 'POST', body: { email, password } })
  if (status === 401) throw new AppError('Wrong email or password.')
  if (!ok) throw new AppError(errorText(json, status))
  const cookie = headers.getSetCookie().find(c => c.startsWith('token='))
  const token = cookie?.slice('token='.length).split(';')[0]
  if (!token) throw new AppError('Calichef did not start a session. Try again.')
  return { token, user: json.user }
}

// Public files of the app (recipe index and recipe shards). No session needed.
export async function fetchPublic (path) {
  const { ok, status, json } = await send(path)
  if (!ok || !json) throw new AppError(`Calichef recipe data is not available (${status} for ${path}). Check that the app was deployed with its recipe index.`)
  return json
}

// A client bound to the signed-in user, built from the OAuth token's stored session.
export function appClient (auth) {
  const { appSession, userId, userName } = auth.extra
  const session = decrypt(appSession)

  async function call (path, options = {}) {
    const result = await send(path, { ...options, session })
    if (result.status === 401) {
      throw new AppError('Your Calichef session ended. Remove and reconnect the connector in Claude to sign in again.')
    }
    if (!result.ok) throw new AppError(errorText(result.json, result.status))
    return result.json
  }

  return { userId, userName, call }
}
