// Copy of calichef/utils/ingredientIcons.js. Copy it again when the app changes it.
// Matches an ingredient name ("de harina de trigo", "2 ripe bananas") to one of the
// Thermomix ingredient icons. The catalog is public/data/ingredient-icons.json,
// written by scripts/build-recipe-index.mjs. The Calichef MCP server keeps a copy
// of this file (src/shared/ingredientIcons.js): change both together.

export const ICON_URL = 'https://assets.tmecosys.com/image/upload/t_web_ingredient_48x48/icons/ingredient_icons/'
export const ICON_URL_RE = /^https:\/\/assets\.tmecosys\.com\/image\/upload\/t_web_ingredient_48x48\/icons\/ingredient_icons\/(\d{1,6})$/
export const iconUrl = (id) => `${ICON_URL}${id}`
export const iconIdOf = (url) => (typeof url === 'string' ? url.match(ICON_URL_RE)?.[1] || null : null)

const ARTICLES = /^(?:de la |de l'|de los |de las |del |de |d'|du |des |of the |of |la |le |les |l'|el |los |las |the |a |an |un |une |una |unos |unas )+/

// Lowercase, no accents, no leading "de / d' / of" and no punctuation.
export function ingredientKey(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ARTICLES, '')
    .trim()
}

// catalog: { icons: [{ id, uses, names: { EN: [...], ES: [...], FR: [...] } }] }
export function createIconMatcher(catalog) {
  const exact = { ALL: new Map() }
  const aliases = []
  for (const icon of catalog?.icons || []) {
    for (const [lang, names] of Object.entries(icon.names || {})) {
      exact[lang] ||= new Map()
      for (const name of names) {
        const key = ingredientKey(name)
        if (key.length < 2) continue
        for (const map of [exact[lang], exact.ALL]) {
          const current = map.get(key)
          if (!current || current.uses < icon.uses) map.set(key, icon)
        }
        aliases.push({ key, lang, icon })
      }
    }
  }
  // Longest names first, so "pechuga de pollo" wins over "pollo".
  aliases.sort((a, b) => b.key.length - a.key.length || b.icon.uses - a.icon.uses)

  return function match(name, lang) {
    const key = ingredientKey(name)
    if (!key) return null
    const hit = exact[lang]?.get(key) || exact.ALL.get(key)
    if (hit) return hit.id
    const padded = ` ${key} `
    const contains = (a) => a.key.length >= 3 && padded.includes(` ${a.key} `)
    const best = aliases.find(a => a.lang === lang && contains(a)) || aliases.find(contains)
    if (best) return best.icon.id
    // Short names inside a longer known one: "jalapeno" -> "chiles jalapenos".
    if (key.length < 4) return null
    const within = (a) => ` ${a.key} `.includes(padded) || ` ${a.key} `.includes(` ${key}s `) || ` ${a.key} `.includes(` ${key}es `)
    const wide = aliases.filter(a => (a.lang === lang || !exact[lang]) && within(a))
    if (!wide.length) return null
    return wide.reduce((a, b) => (b.icon.uses > a.icon.uses ? b : a)).icon.id
  }
}
