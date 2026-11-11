import { createHash } from 'node:crypto'

const SHOW_PASSWORD = "const i=this.previousElementSibling;const s=i.type==='password';i.type=s?'text':'password';this.setAttribute('aria-label',s?'Hide password':'Show password');this.textContent=s?'Hide':'Show'"
const SHOW_PASSWORD_HASH = createHash('sha256').update(SHOW_PASSWORD).digest('base64')

// The page can't be framed, only runs its one inline handler, and its form may only
// go back to this server or to where the sign-in returns.
export function sendPage (res, status, html, redirectUri) {
  const returnTo = (() => {
    try {
      return redirectUri ? ` ${new URL(redirectUri).origin}` : ''
    } catch {
      return ''
    }
  })()
  res.status(status).set({
    'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-hashes' 'sha256-${SHOW_PASSWORD_HASH}'; form-action 'self'${returnTo}; frame-ancestors 'none'; base-uri 'none'`,
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  }).type('html').send(html)
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function renderLogin ({ request, clientName, redirectHost, email = '', error, fatal }) {
  const body = fatal
    ? `<p class="error" role="alert">${escape(fatal)}</p>`
    : `
      <p class="lead"><strong>${escape(clientName)}</strong> wants to use your Calichef account: search recipes, create and edit your own recipes, and manage your favorites, shopping list, notes and ratings.</p>
      <p class="host">You will be sent back to <strong>${escape(redirectHost)}</strong></p>
      ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
      <form method="post" action="/login">
        <input type="hidden" name="request" value="${escape(request)}">
        <label>Email<input name="email" type="email" autocomplete="email" autocapitalize="none" value="${escape(email)}" required></label>
        <label>Password
          <span class="pw">
            <input name="password" type="password" autocomplete="current-password" required>
            <button type="button" class="eye" aria-label="Show password" onclick="${SHOW_PASSWORD}">Show</button>
          </span>
        </label>
        <button class="primary" name="action" value="allow">Sign in and allow</button>
        <button class="secondary" name="action" value="deny" formnovalidate>Cancel</button>
      </form>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Calichef</title>
<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@700;800&display=swap">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:#0F110E;color:#F2EFE6;font:15px/1.5 Inter,system-ui,sans-serif}
  main{width:100%;max-width:400px;display:flex;flex-direction:column;gap:18px}
  .brand{display:flex;align-items:center;gap:12px;font:800 19px 'Plus Jakarta Sans',Inter,sans-serif;letter-spacing:-.02em}
  .logo{width:44px;height:44px;border-radius:12px;background:#fff;object-fit:contain}
  h1{margin:0;font:800 28px/1.1 'Plus Jakarta Sans',Inter,sans-serif;letter-spacing:-.03em}
  .lead{margin:0;color:#A8A496}
  .lead strong{color:#F2EFE6}
  .host{margin:0;font-size:13px;color:#8C887C}
  form{display:flex;flex-direction:column;gap:14px}
  label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:500;color:#A8A496}
  input{height:48px;padding:0 14px;border-radius:12px;background:#1A1D19;border:1px solid #3A3F37;color:#F2EFE6;font:inherit;outline:none;width:100%}
  input:focus{border-color:#2BA845}
  .pw{position:relative;display:block}
  .pw input{padding-right:64px}
  .eye{position:absolute;right:6px;top:8px;height:32px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:#A8A496;font:inherit;font-size:12px;cursor:pointer}
  .primary{height:50px;border:0;border-radius:12px;background:#2BA845;color:#0F110E;font:inherit;font-weight:600;cursor:pointer}
  .secondary{height:46px;border-radius:12px;background:transparent;border:1px solid #3A3F37;color:#F2EFE6;font:inherit;cursor:pointer}
  .error{margin:0;padding:12px 14px;border-radius:10px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);color:#F87171}
  :focus-visible{outline:2px solid #2BA845;outline-offset:2px}
</style>
</head>
<body>
<main>
  <div class="brand"><img class="logo" src="/icon.jpg" alt="" width="44" height="44">Calichef</div>
  <h1>Connect to Claude</h1>
  ${body}
</main>
</body>
</html>`
}
