import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { glyphsToTokens, tokensToGlyphs, SYMBOLS } from '../src/glyphs.js'
import { normalize, searchRows, shardOf, summary } from '../src/recipes.js'
import { _internal } from '../src/tools.js'

process.env.APP_URL ||= 'https://calichef.example'

test('Thermomix symbols go to tokens and back unchanged', () => {
  const text = 'cook 10 min/100°C//speed , then start Blend /30 sec'
  const tokens = glyphsToTokens(text)
  assert.equal(tokens, 'cook 10 min/100°C/[reverse]/speed [spoon], then start Blend [blend]/30 sec')
  assert.equal(tokensToGlyphs(tokens), text)
  assert.equal(tokensToGlyphs('Add [Reverse] and [unknown]'), 'Add  and [unknown]')
  assert.equal(new Set(SYMBOLS.map(s => s[1])).size, SYMBOLS.length)
})

test('shards match the app build script (md5 of the id, first 8 hex digits)', () => {
  const expected = parseInt(createHash('md5').update('r603811').digest('hex').slice(0, 8), 16) % 128
  assert.equal(shardOf('r603811', 128), expected)
})

test('search ignores case and accents and needs every word', () => {
  const row = (id, title, extra = {}) => ({ id, title, category: '', language: 'ES', countries: [], tm_versions: [], source: 'thermomix', search: normalize(title), ...extra })
  const rows = [
    row('r1', 'Pan de plátano', { rating: 4.5, rating_count: 100 }),
    row('r2', 'Plátanos fritos', { rating: 5, rating_count: 10 }),
    row('r3', 'Sopa de tomate')
  ]
  assert.deepEqual(searchRows(rows, { query: 'PLATANO' }).map(r => r.id).sort(), ['r1', 'r2'])
  assert.deepEqual(searchRows(rows, { query: 'pan platano' }).map(r => r.id), ['r1'])
  assert.equal(searchRows(rows, { query: 'platano', language: 'EN' }).length, 0)
  assert.equal(summary(rows[0]).url, 'https://calichef.example/r1')
})

test('tool arguments become the form the Calichef API expects', () => {
  const form = _internal.toForm({
    title: 'Sopa',
    difficulty: 'easy',
    public: false,
    ingredients: [{ items: [{ amount: '1', name: 'cebolla', note: 'en cuartos' }] }],
    steps: ['Pique 5 seg/vel 5.', 'Sofría 5 min/120°C/[reverse]/vel [spoon].']
  }, { ingredients: [], steps: [], tips: [], tm_versions: [] })
  assert.equal(form.difficulty, 'E')
  assert.equal(form.isPublic, false)
  assert.deepEqual(form.ingredients, [{ group: '', items: [{ amount: '1', name: 'cebolla', description: 'en cuartos' }] }])
  assert.equal(form.steps[1], 'Sofría 5 min/120°C//vel .')
  assert.deepEqual(form.tips, [])

  // Updates keep what was not passed.
  const updated = _internal.toForm({ title: 'Sopa nueva' }, form)
  assert.equal(updated.title, 'Sopa nueva')
  assert.deepEqual(updated.steps, form.steps)
  assert.equal(updated.isPublic, false)
})
