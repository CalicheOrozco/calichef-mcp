import { readFileSync } from 'node:fs'
import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { config } from './config.js'
import { handleLogin, provider } from './oauth.js'
import { limit } from './rateLimit.js'
import { registerTools } from './tools.js'

// Calichef icon. On Vercel the public folder is served as static files before
// this app runs; these routes cover local runs. Files are read on demand so a
// bundle without them can never crash the server at startup.
const ASSETS = {
  '/favicon.ico': { type: 'image/x-icon', file: '../public/favicon.ico' },
  '/icon.jpg': { type: 'image/jpeg', file: '../public/icon.jpg' },
  '/icon-512.jpg': { type: 'image/jpeg', file: '../public/icon-512.jpg' }
}
const assetCache = new Map()
function readAsset (path) {
  if (!assetCache.has(path)) {
    try {
      assetCache.set(path, readFileSync(new URL(ASSETS[path].file, import.meta.url)))
    } catch {
      assetCache.set(path, null)
    }
  }
  return assetCache.get(path)
}

const app = express()
app.disable('x-powered-by')
// Vercel sits in front, so client IPs for rate limiting come from X-Forwarded-For.
app.set('trust proxy', 1)

for (const [path, { type }] of Object.entries(ASSETS)) {
  app.get(path, (req, res) => {
    const data = readAsset(path)
    if (!data) return res.status(404).end()
    res.set('Cache-Control', 'public, max-age=86400').type(type).send(data)
  })
}

// Registration is open by design, so it is limited per address across instances.
app.post('/register', limit('register', 20, 60 * 60 * 1000))

const baseUrl = new URL(config.baseUrl)
const mcpUrl = new URL('/mcp', baseUrl)

app.use(mcpAuthRouter({
  provider,
  issuerUrl: baseUrl,
  baseUrl,
  resourceServerUrl: mcpUrl,
  resourceName: 'Calichef',
  scopesSupported: ['calichef'],
  // Client secrets never expire, so a connector Claude registered keeps working.
  clientRegistrationOptions: { clientSecretExpirySeconds: 0 }
}))

app.post('/login', express.urlencoded({ extended: false }), (req, res, next) => {
  handleLogin(req, res).catch(next)
})

const bearer = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl)
})

const serverInfo = () => ({
  name: 'calichef',
  title: 'Calichef',
  version: '1.0.0',
  websiteUrl: config.appUrl,
  icons: [
    { src: new URL('/icon.jpg', baseUrl).href, mimeType: 'image/jpeg', sizes: ['192x192'] },
    { src: new URL('/icon-512.jpg', baseUrl).href, mimeType: 'image/jpeg', sizes: ['512x512'] }
  ]
})

const INSTRUCTIONS = 'Calichef is a Thermomix recipe app. Use search_recipes to find recipes and get_recipe to read one. When the user wants to save or write their own recipe, use create_recipe, following the step format in its description so Thermomix settings and symbols show correctly in the app. Always share the recipe link (url) after creating or changing a recipe.'

// Stateless: every request gets its own server bound to the caller's account.
app.post('/mcp', bearer, express.json({ limit: '4mb' }), async (req, res) => {
  const server = new McpServer(serverInfo(), { instructions: INSTRUCTIONS })
  registerTools(server, req.auth)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    console.error('MCP request failed:', error)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  }
})

app.all('/mcp', bearer, (req, res) => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
})

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Calichef MCP</title><link rel="icon" href="/favicon.ico"></head><body style="font:15px system-ui;background:#0F110E;color:#F2EFE6;padding:32px"><img src="/icon.jpg" alt="" width="64" height="64" style="border-radius:14px;background:#fff"><p>Calichef MCP server.</p><p>Add <code>${mcpUrl.href}</code> as a custom connector in Claude.</p></body></html>`)
})

app.use((error, req, res, next) => {
  console.error(error)
  if (res.headersSent) return next(error)
  res.status(500).type('text').send('Something went wrong.')
})

export default app
