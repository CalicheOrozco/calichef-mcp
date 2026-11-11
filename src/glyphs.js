// Calichef recipe text uses private-use characters of the Vorwerk icon font for
// Thermomix symbols. Claude reads and writes them as [tokens] instead.
export const SYMBOLS = [
  ['reverse', '', 'Reverse blade direction'],
  ['spoon', '', 'Spoon (gentle stirring) speed'],
  ['dough', '', 'Dough mode'],
  ['high-temp', '', 'High Temp. mode (browning / sautéing)'],
  ['blend', '', 'Blend mode'],
  ['thicken', '', 'Thicken mode'],
  ['warm-up', '', 'Warm Up mode'],
  ['slow-cook', '', 'Slow Cook mode'],
  ['sous-vide', '', 'Sous-vide mode'],
  ['fermentation', '', 'Fermentation mode'],
  ['kettle', '', 'Kettle mode'],
  ['rice-cooker', '', 'Rice Cooker mode'],
  ['egg-boiler', '', 'Egg Boiler mode'],
  ['sugar-stages', '', 'Sugar Stages mode'],
  ['slicing', '', 'Slicing mode (Thermomix Cutter)'],
  ['grating', '', 'Grating mode (Thermomix Cutter)'],
  ['spiralizing', '', 'Spiralizing mode'],
  ['peeler', '', 'Peeler mode'],
  ['pre-clean', '', 'Pre-clean mode'],
  ['open-cooking', '', 'Open cooking (no lid)'],
  ['cutting', '', 'Cutting mode']
]

const toToken = new Map(SYMBOLS.map(([token, glyph]) => [glyph, `[${token}]`]))
const toGlyph = new Map(SYMBOLS.map(([token, glyph]) => [token, glyph]))

// "cook 10 min/100°C//speed 1" -> "cook 10 min/100°C/[reverse]/speed 1"
export const glyphsToTokens = text =>
  typeof text === 'string'
    ? text.replace(/[-]/g, ch => toToken.get(ch) || '[symbol]')
    : text

// Back to the icon characters the app renders. Unknown [words] are left as written.
export const tokensToGlyphs = text =>
  typeof text === 'string'
    ? text.replace(/\[([a-z-]+)\]/gi, (match, token) => toGlyph.get(token.toLowerCase()) || match)
    : text

export const TOKEN_LIST = SYMBOLS.map(([token, , meaning]) => `[${token}] ${meaning}`).join('; ')
