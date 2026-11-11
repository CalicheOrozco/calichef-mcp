import { z } from 'zod'
import { AppError, appClient } from './appApi.js'
import { TOKEN_LIST, glyphsToTokens, tokensToGlyphs } from './glyphs.js'
import { iconUrl } from './shared/ingredientIcons.js'
import {
  DIFFICULTY,
  DIFFICULTY_CODE,
  communityRow,
  findIcons,
  ingredientIcons,
  isUserRecipeId,
  minutesOf,
  readableRecipe,
  recipeUrl,
  searchRows,
  summary,
  thermomixIndex,
  thermomixRecipe
} from './recipes.js'

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }

// Ids go into API paths, so only real ids are accepted.
const recipeId = z.string().regex(/^[A-Za-z0-9]{1,40}$/, 'Use a recipe id returned by search_recipes or list_my_recipes')
const userRecipeId = z.string().regex(/^u[0-9a-f]{24}$/, 'Use the id of one of your recipes (it starts with "u"), from list_my_recipes')
const language = z.enum(['EN', 'ES', 'FR'])
const tmVersion = z.enum(['tm5', 'tm6', 'tm7'])

const STEP_FORMAT = `Write Thermomix settings like the official recipes, as time/temperature/speed separated by "/": "chop 5 sec/speed 5", "cook 10 min/100°C/speed 1", "steam 20 min/Varoma/speed 1", "Turbo/1 sec/2 times". Use the speed word of the recipe language: "speed" (EN), "vel" (ES), "vitesse" (FR). Write Thermomix symbols as tokens and they become icons: reverse goes between slashes before the speed ("cook 10 min/100°C/[reverse]/speed [spoon]"), modes go after their name ("start Blend [blend]/30 sec", "sauté High Temp. [high-temp]/5 min", "knead Dough [dough]/2 min"). Tokens: ${TOKEN_LIST}.`

const ingredientsSchema = z.array(z.object({
  group: z.string().max(120).optional().describe('Group name like "Dough" or "Filling". Leave empty when there is only one group'),
  items: z.array(z.object({
    amount: z.string().max(120).optional().describe('Quantity with unit, e.g. "200 g", "2", "1 tbsp"'),
    name: z.string().min(1).max(120).describe('Ingredient, e.g. "flour"'),
    note: z.string().max(120).optional().describe('Optional detail, e.g. "diced" or "to taste"'),
    icon_id: z.string().regex(/^(\d{1,6}|none)$/).optional().describe('Thermomix ingredient icon. Leave it out and the icon is picked from the name automatically; pass an id from search_ingredient_icons to choose another, or "none" for no icon')
  })).min(1).max(60)
})).max(20)

// Fields shared by create_recipe and update_recipe (all optional for updates).
const recipeFields = {
  image_url: z.string().url().max(2000).optional().describe('Public http(s) URL of a photo. Only use a URL the user gave you'),
  category: z.string().max(120).optional().describe('e.g. "Soups", "Desserts"'),
  difficulty: z.enum(['easy', 'medium', 'advanced']).optional(),
  prep_minutes: z.number().int().positive().max(10000).optional(),
  total_minutes: z.number().int().positive().max(10000).optional(),
  servings: z.number().positive().max(1000).optional(),
  servings_unit: z.string().max(40).optional().describe('e.g. "servings", "portions", "pieces", "porciones"'),
  tm_versions: z.array(tmVersion).max(3).optional().describe('Thermomix models the recipe works with'),
  language: language.optional().describe('Language the recipe is written in'),
  ingredients: ingredientsSchema.optional(),
  steps: z.array(z.string().min(1).max(2000)).max(100).optional().describe(`One entry per step, without numbering. ${STEP_FORMAT}`),
  tips: z.array(z.string().min(1).max(2000)).max(30).optional(),
  public: z.boolean().optional().describe('true: everyone can see it (default for new recipes). false: only the user')
}

function ok (data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail (error) {
  return { isError: true, content: [{ type: 'text', text: error.message || String(error) }] }
}

// Tool arguments -> the form body the Calichef API expects. pickIcon(name) returns
// the icon id for an ingredient name (auto-matched in the recipe language).
function toForm (a, base = {}, pickIcon = () => null) {
  const imageFor = i => {
    if (i.icon_id === 'none') return ''
    const id = i.icon_id || pickIcon(i.name)
    return id ? iconUrl(id) : ''
  }
  const pick = (key, value) => (value === undefined ? base[key] : value)
  return {
    ...base,
    title: pick('title', a.title),
    image_url: pick('image_url', a.image_url),
    category: pick('category', a.category),
    difficulty: a.difficulty === undefined ? base.difficulty : DIFFICULTY_CODE[a.difficulty],
    prep_minutes: pick('prep_minutes', a.prep_minutes),
    total_minutes: pick('total_minutes', a.total_minutes),
    servings: pick('servings', a.servings),
    servings_unit: pick('servings_unit', a.servings_unit),
    tm_versions: pick('tm_versions', a.tm_versions),
    language: pick('language', a.language),
    isPublic: a.public === undefined ? base.isPublic : a.public,
    ingredients: a.ingredients === undefined
      ? base.ingredients
      : a.ingredients.map(g => ({
        group: g.group || '',
        items: g.items.map(i => ({ amount: i.amount || '', name: i.name, description: i.note || '', image: imageFor(i) }))
      })),
    steps: a.steps === undefined ? base.steps : a.steps.map(tokensToGlyphs),
    tips: a.tips === undefined ? base.tips : a.tips.map(tokensToGlyphs)
  }
}

export function registerTools (server, auth) {
  const api = appClient(auth)

  const me = async () => (await api.call('/api/auth/me')).user
  const communityRecipes = async () => (await api.call('/api/recipes')).recipes || []

  // Loads any recipe (Thermomix or community) in the app's shape.
  async function loadRecipe (id) {
    if (isUserRecipeId(id)) {
      const data = await api.call(`/api/recipes/${id}`)
      return { ...data.recipe, form: data.form }
    }
    const recipe = await thermomixRecipe(id)
    if (!recipe) throw new AppError(`No recipe with id ${id}. Use search_recipes to find one.`)
    return recipe
  }

  // id -> short row, for lists of favorites and shopping list items.
  async function rowsFor (ids) {
    if (!ids.length) return []
    const [{ byId }, community] = await Promise.all([
      thermomixIndex(),
      ids.some(isUserRecipeId) ? communityRecipes() : []
    ])
    const mine = new Map(community.map(r => [r.id, communityRow(r)]))
    return ids.map(id => byId.get(id) || mine.get(id) || null)
  }

  // Auto-picks ingredient icons in the recipe language, only when ingredients are sent.
  async function iconPicker (a, lang) {
    if (!a.ingredients?.length) return undefined
    const { match } = await ingredientIcons()
    return name => match(name, lang)
  }

  function tool (name, config, handler) {
    server.registerTool(name, config, async args => {
      try {
        return ok(await handler(args || {}))
      } catch (error) {
        // Expected problems (bad input, the app saying no) only go back to Claude.
        // Anything else is also logged, without the arguments.
        const expected = error instanceof AppError || error.constructor === Error
        if (!expected) console.error(`Tool ${name} failed:`, error)
        return fail(error)
      }
    })
  }

  // ---------- Search and read ----------

  tool('search_recipes', {
    title: 'Search recipes',
    description: 'Search Calichef recipes: about 37,000 official Thermomix recipes plus community recipes created by users (public ones and the user\'s own private ones). Matching ignores case and accents, and every word must appear in the title or category. Returns short results; use get_recipe for ingredients and steps.',
    inputSchema: {
      query: z.string().max(200).optional().describe('Words to find, e.g. "chicken curry". Leave empty to browse with filters'),
      source: z.enum(['all', 'thermomix', 'community']).optional().describe('Default all'),
      language: language.optional().describe('Recipe language. Thermomix recipes exist in English, Spanish and French'),
      category: z.string().max(120).optional(),
      country: z.string().max(10).optional().describe('Country code of the Thermomix recipe book, e.g. MX, ES, US, FR, UK, AU, CA'),
      max_total_minutes: z.number().int().positive().optional(),
      tm_version: tmVersion.optional(),
      difficulty: z.enum(['easy', 'medium', 'advanced']).optional(),
      min_rating: z.number().min(0).max(5).optional(),
      sort: z.enum(['relevance', 'rating', 'fastest', 'newest']).optional().describe('newest only orders community recipes'),
      limit: z.number().int().min(1).max(50).optional().describe('Default 20'),
      offset: z.number().int().min(0).optional()
    },
    annotations: READ
  }, async a => {
    const source = a.source || 'all'
    const [index, community] = await Promise.all([
      source === 'community' ? null : thermomixIndex(),
      source === 'thermomix' ? [] : communityRecipes()
    ])
    const rows = [
      ...community.map(communityRow),
      ...(index ? index.rows : [])
    ]
    const found = searchRows(rows, a)
    const offset = a.offset || 0
    const limit = a.limit || 20
    return {
      total: found.length,
      showing: `${Math.min(offset + 1, found.length)}-${Math.min(offset + limit, found.length)}`,
      results: found.slice(offset, offset + limit).map(summary)
    }
  })

  tool('get_recipe', {
    title: 'Get recipe',
    description: `Full recipe: ingredients, steps, tips, nutrition and the user's own note, rating, favorite and shopping list status. Thermomix symbols in steps appear as tokens: ${TOKEN_LIST}.`,
    inputSchema: { id: recipeId },
    annotations: READ
  }, async a => {
    const [recipe, user, shopping] = await Promise.all([
      loadRecipe(a.id),
      me(),
      api.call('/api/shopping-list')
    ])
    const note = (user.notes || []).find?.(n => n.idRecipe === a.id)?.note
    const rating = (user.ratings || []).find(r => r.idRecipe === a.id)?.rating
    const inList = (shopping.items || []).find(i => i.idRecipe === a.id)
    return {
      ...readableRecipe(recipe),
      mine: isUserRecipeId(a.id) ? recipe.ownerId === String(user._id) : false,
      my_rating: rating || undefined,
      my_note: note || undefined,
      is_favorite: (user.favorites || []).includes(a.id),
      in_shopping_list: inList ? { count: inList.count } : false
    }
  })

  tool('search_ingredient_icons', {
    title: 'Search ingredient icons',
    description: 'Find Thermomix ingredient icons by name (any language), to choose a different icon_id than the one picked automatically when creating or updating a recipe. Most used icons first.',
    inputSchema: { query: z.string().min(1).max(120).describe('Ingredient name, e.g. "tomato", "harina", "beurre"') },
    annotations: READ
  }, async a => {
    const { icons } = await ingredientIcons()
    const results = findIcons(icons, a.query)
    return results.length ? results : { results: [], note: 'No icon found. Try a simpler or singular name, or another language.' }
  })

  // ---------- My recipes ----------

  tool('list_my_recipes', {
    title: 'List my recipes',
    description: 'Recipes the user created in Calichef (public and private), newest first.',
    annotations: READ
  }, async () => {
    const mine = (await communityRecipes()).filter(r => r.ownerId === api.userId)
    return mine.map(r => summary(communityRow(r)))
  })

  tool('create_recipe', {
    title: 'Create recipe',
    description: `Create a recipe in the user's Calichef account. It is public by default (everyone can see it) unless the user asks for it to be private. Write it in the language the user is using unless they ask otherwise, and set language accordingly. Ingredient icons are picked from each ingredient name automatically. ${STEP_FORMAT} Returns the new recipe's id and link.`,
    inputSchema: {
      title: z.string().min(1).max(150),
      ...recipeFields,
      based_on_id: recipeId.optional().describe('When adapting an existing recipe, its id. The new recipe shows "Based on <that recipe>"')
    },
    annotations: WRITE
  }, async a => {
    let basedOn = { id: '', title: '' }
    if (a.based_on_id) {
      const source = await loadRecipe(a.based_on_id)
      basedOn = { id: a.based_on_id, title: source.title }
    }
    const lang = a.language || (await me()).languagePreferences?.find(l => ['EN', 'ES', 'FR'].includes(l)) || 'EN'
    const body = toForm({ ...a, language: lang, public: a.public ?? true }, {
      ingredients: [], steps: [], tips: [], tm_versions: [], basedOn
    }, await iconPicker(a, lang))
    const { recipe } = await api.call('/api/recipes', { method: 'POST', body })
    return { created: true, id: recipe.id, title: recipe.title, public: recipe.isPublic, url: recipeUrl(recipe.id) }
  })

  tool('update_recipe', {
    title: 'Update recipe',
    description: `Change one of the user's own recipes. Only the fields you pass change; ingredients, steps and tips replace the whole list, so send the complete list. ${STEP_FORMAT}`,
    inputSchema: {
      id: userRecipeId,
      title: z.string().min(1).max(150).optional(),
      ...recipeFields
    },
    annotations: WRITE
  }, async a => {
    const current = await loadRecipe(a.id)
    if (!current.form) throw new AppError('Only the author can change this recipe.')
    const lang = a.language || current.form.language
    const { recipe } = await api.call(`/api/recipes/${a.id}`, { method: 'PUT', body: toForm(a, current.form, await iconPicker(a, lang)) })
    return { updated: true, id: recipe.id, title: recipe.title, public: recipe.isPublic, url: recipeUrl(recipe.id) }
  })

  tool('delete_recipe', {
    title: 'Delete recipe',
    description: 'Permanently delete one of the user\'s own recipes. It also disappears from other users\' favorites and shopping lists. Only when the user explicitly asks.',
    inputSchema: { id: userRecipeId },
    annotations: DESTROY
  }, async a => {
    await api.call(`/api/recipes/${a.id}`, { method: 'DELETE' })
    return { deleted: true, id: a.id }
  })

  // ---------- Favorites ----------

  tool('list_favorites', {
    title: 'List favorites',
    description: 'The user\'s favorite recipes, in the order they saved them.',
    annotations: READ
  }, async () => {
    const ids = (await me()).favorites || []
    return (await rowsFor(ids)).map((r, i) => (r ? summary(r) : { id: ids[i], unavailable: 'This recipe was deleted or made private' }))
  })

  // The app toggles favorites, so the current state is checked first.
  async function setFavorite (id, wanted) {
    const favorites = (await me()).favorites || []
    if (favorites.includes(id) !== wanted) {
      await api.call('/api/auth/favorites', { method: 'POST', body: { recipeId: id } })
    }
    return { id, is_favorite: wanted }
  }

  tool('add_favorite', {
    title: 'Add to favorites',
    description: 'Save a recipe in the user\'s favorites.',
    inputSchema: { recipe_id: recipeId },
    annotations: WRITE
  }, async a => {
    await loadRecipe(a.recipe_id)
    return setFavorite(a.recipe_id, true)
  })

  tool('remove_favorite', {
    title: 'Remove from favorites',
    description: 'Remove a recipe from the user\'s favorites.',
    inputSchema: { recipe_id: recipeId },
    annotations: WRITE
  }, async a => setFavorite(a.recipe_id, false))

  // ---------- Shopping list ----------

  tool('get_shopping_list', {
    title: 'Shopping list',
    description: 'Recipes in the user\'s shopping list with how many times each was added and, by default, their ingredients (amounts are for one batch; multiply by count).',
    inputSchema: {
      include_ingredients: z.boolean().optional().describe('Default true')
    },
    annotations: READ
  }, async a => {
    const items = (await api.call('/api/shopping-list')).items || []
    const withIngredients = a.include_ingredients !== false
    return Promise.all(items.map(async item => {
      let recipe
      try {
        recipe = await loadRecipe(item.idRecipe)
      } catch {
        return { id: item.idRecipe, count: item.count, unavailable: 'This recipe was deleted or made private' }
      }
      const readable = readableRecipe(recipe)
      return {
        id: item.idRecipe,
        title: recipe.title,
        count: item.count,
        servings: readable.servings,
        url: readable.url,
        ingredients: withIngredients ? readable.ingredients : undefined
      }
    }))
  })

  tool('add_to_shopping_list', {
    title: 'Add to shopping list',
    description: 'Add a recipe to the shopping list. If it is already there, its count goes up by the given amount.',
    inputSchema: {
      recipe_id: recipeId,
      count: z.number().int().min(1).max(20).optional().describe('How many batches, default 1')
    },
    annotations: WRITE
  }, async a => {
    await loadRecipe(a.recipe_id)
    const { items } = await api.call('/api/auth/shoppingList', { method: 'PATCH', body: { idRecipe: a.recipe_id, count: a.count || 1 } })
    const item = (items || []).find(i => i.idRecipe === a.recipe_id)
    return { id: a.recipe_id, count: item?.count ?? a.count ?? 1 }
  })

  tool('remove_from_shopping_list', {
    title: 'Remove from shopping list',
    description: 'Remove a recipe from the shopping list completely.',
    inputSchema: { recipe_id: recipeId },
    annotations: WRITE
  }, async a => {
    await api.call('/api/auth/shoppingList', { method: 'DELETE', body: { idRecipe: a.recipe_id } })
    return { id: a.recipe_id, removed: true }
  })

  // ---------- Notes and ratings ----------

  tool('set_recipe_note', {
    title: 'Save note',
    description: 'Save the user\'s private note on a recipe (replaces any previous note). Pass an empty note to delete it.',
    inputSchema: {
      recipe_id: recipeId,
      note: z.string().max(5000)
    },
    annotations: WRITE
  }, async a => {
    if (!a.note.trim()) {
      await api.call('/api/auth/notes', { method: 'DELETE', body: { recipeId: a.recipe_id } }).catch(error => {
        if (!/no encontrada|not found/i.test(error.message)) throw error
      })
      return { id: a.recipe_id, note: null }
    }
    await loadRecipe(a.recipe_id)
    await api.call('/api/auth/notes', { method: 'POST', body: { recipeId: a.recipe_id, noteContent: a.note } })
    return { id: a.recipe_id, note: a.note }
  })

  tool('rate_recipe', {
    title: 'Rate recipe',
    description: 'Save the user\'s personal rating of a recipe, from 1 to 5 stars. 0 removes it. Ratings of community recipes count toward their average.',
    inputSchema: {
      recipe_id: recipeId,
      rating: z.number().int().min(0).max(5)
    },
    annotations: WRITE
  }, async a => {
    if (a.rating) await loadRecipe(a.recipe_id)
    await api.call('/api/auth/ratings', { method: 'POST', body: { recipeId: a.recipe_id, rating: a.rating || null } })
    return { id: a.recipe_id, my_rating: a.rating || null }
  })

  // ---------- Account ----------

  tool('whoami', {
    title: 'Connected account',
    description: 'Which Calichef account this connector is signed in to, with its preferred recipe languages and counts of favorites and own recipes.',
    annotations: READ
  }, async () => {
    const [user, community] = await Promise.all([me(), communityRecipes()])
    return {
      name: user.name,
      email: user.email,
      languages: user.languagePreferences,
      favorites: (user.favorites || []).length,
      my_recipes: community.filter(r => r.ownerId === String(user._id)).length,
      app: recipeUrl('').replace(/\/$/, '')
    }
  })
}

// Exported for tests.
export const _internal = { toForm, DIFFICULTY, minutesOf, glyphsToTokens }
