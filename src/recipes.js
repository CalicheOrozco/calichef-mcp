import { createHash } from 'node:crypto'
import { fetchPublic } from './appApi.js'
import { config } from './config.js'
import { glyphsToTokens } from './glyphs.js'

const INDEX_TTL = 60 * 60 * 1000
const MAX_SHARDS_CACHED = 12

export const isUserRecipeId = id => /^u[0-9a-f]{24}$/.test(id)
export const DIFFICULTY = { E: 'easy', M: 'medium', A: 'advanced' }
export const DIFFICULTY_CODE = { easy: 'E', medium: 'M', advanced: 'A' }

// Same normalization as the app: case and accent insensitive.
export const normalize = value =>
  String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const recipeUrl = id => `${config.appUrl}/${id}`

// ---------- Thermomix recipes (static data built by the app) ----------

let indexCache = null

// The index lists every Thermomix recipe in a few MB. It is kept in memory while
// the serverless instance lives, and refreshed hourly.
export async function thermomixIndex () {
  if (indexCache && Date.now() - indexCache.loadedAt < INDEX_TTL) return indexCache.promise
  const promise = fetchPublic('/data/recipe-index.json').then(data => {
    const rows = data.rows.map(([id, title, category, language, countries, totalMinutes, rating, ratingCount, tm, difficulty]) => ({
      id,
      title,
      category,
      language,
      countries: countries ? countries.split(',') : [],
      total_minutes: totalMinutes,
      rating,
      rating_count: ratingCount,
      tm_versions: tm ? tm.split(',') : [],
      difficulty: DIFFICULTY[difficulty] || undefined,
      source: 'thermomix',
      search: normalize(`${title} ${category}`)
    }))
    return { shards: data.shards, rows, byId: new Map(rows.map(r => [r.id, r])) }
  })
  indexCache = { loadedAt: Date.now(), promise }
  promise.catch(() => { indexCache = null })
  return promise
}

const shardCache = new Map()

// Must match shardOf() in the app's scripts/build-recipe-index.mjs.
export const shardOf = (id, shards) =>
  parseInt(createHash('md5').update(String(id)).digest('hex').slice(0, 8), 16) % shards

export async function thermomixRecipe (id) {
  const { shards, byId } = await thermomixIndex()
  if (!byId.has(id)) return null
  const name = String(shardOf(id, shards)).padStart(3, '0')
  if (!shardCache.has(name)) {
    if (shardCache.size >= MAX_SHARDS_CACHED) shardCache.delete(shardCache.keys().next().value)
    const promise = fetchPublic(`/data/recipes/${name}.json`)
    promise.catch(() => shardCache.delete(name))
    shardCache.set(name, promise)
  }
  return (await shardCache.get(name))[id] || null
}

// ---------- Community recipes (from the API, as the signed-in user) ----------

export const communityRow = r => ({
  id: r.id,
  title: r.title,
  category: r.category?.[0] || '',
  language: r.language,
  countries: [],
  total_minutes: minutesOf(r.total_time),
  rating: r.rating_score ? Number(r.rating_score) : null,
  rating_count: r.rating_count ? Number(r.rating_count) : null,
  tm_versions: r.tm_versions || [],
  difficulty: DIFFICULTY[r.difficulty] || undefined,
  source: 'community',
  author: r.author?.name || undefined,
  public: r.isPublic,
  owner_id: r.ownerId,
  search: normalize(`${r.title} ${r.category?.[0] || ''}`)
})

export function minutesOf (text) {
  let total = 0
  for (const m of String(text || '').matchAll(/(\d+)\s*(h|min)/gi)) {
    total += m[2].toLowerCase() === 'h' ? Number(m[1]) * 60 : Number(m[1])
  }
  return total || null
}

// ---------- Search ----------

export function searchRows (rows, f) {
  const words = normalize(f.query || '').split(/\s+/).filter(Boolean)
  const category = f.category ? normalize(f.category) : null
  const results = rows.filter(r =>
    (!words.length || words.every(w => r.search.includes(w))) &&
    (!f.language || r.language === f.language) &&
    (!category || normalize(r.category).includes(category)) &&
    (!f.country || r.countries.includes(f.country)) &&
    (!f.max_total_minutes || (r.total_minutes && r.total_minutes <= f.max_total_minutes)) &&
    (!f.tm_version || r.tm_versions.includes(f.tm_version)) &&
    (!f.min_rating || (r.rating || 0) >= f.min_rating) &&
    (!f.difficulty || r.difficulty === f.difficulty)
  )

  // Relevance: words that start the title first, then popular, well rated recipes.
  const popularity = r => (r.rating || 0) * Math.log10((r.rating_count || 0) + 1)
  const startsWith = r => (words.length && normalize(r.title).startsWith(words[0]) ? 1 : 0)
  const sorters = {
    relevance: (a, b) => startsWith(b) - startsWith(a) || popularity(b) - popularity(a),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.rating_count || 0) - (a.rating_count || 0),
    fastest: (a, b) => (a.total_minutes || Infinity) - (b.total_minutes || Infinity),
    newest: () => 0
  }
  results.sort(sorters[f.sort] || sorters.relevance)
  return results
}

// Public shape of a search result (no internal fields).
export const summary = r => ({
  id: r.id,
  title: r.title,
  source: r.source,
  author: r.author,
  public: r.source === 'community' ? r.public : undefined,
  category: r.category || undefined,
  language: r.language || undefined,
  countries: r.countries.length ? r.countries : undefined,
  total_minutes: r.total_minutes || undefined,
  difficulty: r.difficulty,
  rating: r.rating ?? undefined,
  rating_count: r.rating_count ?? undefined,
  tm_versions: r.tm_versions.length ? r.tm_versions : undefined,
  url: recipeUrl(r.id)
})

// ---------- Full recipe for Claude ----------

export function readableRecipe (r) {
  return {
    id: r.id,
    title: r.title,
    url: recipeUrl(r.id),
    source: r.source === 'community' ? 'community' : 'thermomix',
    author: r.author?.name || undefined,
    public: r.source === 'community' ? r.isPublic : undefined,
    based_on: r.basedOn || undefined,
    image_url: r.image_url || undefined,
    category: r.category?.length ? r.category : undefined,
    difficulty: DIFFICULTY[r.difficulty] || undefined,
    prep_time: r.cooking_time || undefined,
    total_time: r.total_time || undefined,
    servings: r.porciones || undefined,
    tm_versions: r.tm_versions?.length ? r.tm_versions : undefined,
    language: r.language,
    countries: r.country?.length ? r.country : undefined,
    rating: r.rating_score ? Number(r.rating_score) : undefined,
    rating_count: r.rating_count ? Number(r.rating_count) : undefined,
    ingredients: Object.entries(r.ingredients || {}).map(([group, items]) => ({
      group,
      items: (items || []).map(i => ({
        amount: i.amount || undefined,
        name: i.name,
        note: i.description || undefined
      }))
    })),
    steps: (r.steps || []).map(glyphsToTokens),
    tips: (r.tips || []).length ? r.tips.map(glyphsToTokens) : undefined,
    nutrition: Array.isArray(r.nutritions) && r.nutritions.length ? r.nutritions : undefined
  }
}
