# Calichef MCP

Remote MCP server that lets Claude (claude.ai on the web and mobile, Claude Desktop, and Claude Code) use Calichef, signed in as you: search the Thermomix recipes, read them, create your own recipes, and manage favorites, shopping list, notes and ratings.

It calls the Calichef API on your behalf and reads the recipe search index the app publishes. It never touches the app's database directly; its own database only holds OAuth clients and tokens.

## How sign-in works

1. In Claude you add `https://<this-server>/mcp` as a custom connector.
2. Claude registers itself (OAuth Dynamic Client Registration) and opens this server's sign-in page.
3. You sign in with your Calichef email and password. The server keeps the resulting Calichef session encrypted and gives Claude its own tokens.
4. Access tokens last an hour and refresh tokens rotate on every use. When the Calichef session ends (30 days), Claude asks you to sign in again.

Only redirect hosts in `ALLOWED_REDIRECT_HOSTS` (Claude's by default) can register, so nobody can use this sign-in page to send codes to another site.

## Recipe data

The Thermomix recipes are about 160 MB of JSON, too much to download on every call. When Calichef builds, its `prebuild` script (`scripts/build-recipe-index.mjs`) writes:

- `/data/recipe-index.json`: one short row per recipe (about 4 MB, 0.8 MB compressed), used for searching. Loaded once per server instance and refreshed hourly.
- `/data/recipes/000.json` to `127.json`: the full recipes split by id (about 750 KB each). `get_recipe` downloads only the one file that holds the recipe.

`shardOf()` in `src/recipes.js` must match the one in that script. Community recipes come from the app's `/api/recipes`.

## Thermomix symbols

Steps in Calichef use characters of the Vorwerk icon font for reverse, spoon speed, dough and the TM6 / TM7 modes. Claude reads and writes them as tokens such as `[reverse]`, `[spoon]` or `[high-temp]`, and this server converts them both ways (`src/glyphs.js`).

## Icon

The connector shows the Calichef chef hat: it is served at `/favicon.ico`, `/icon.jpg` and `/icon-512.jpg`, and listed in the MCP server info (`icons`).

## Environment variables

| Name | Purpose |
| --- | --- |
| `BASE_URL` | Public URL of this server, no trailing slash |
| `APP_URL` | URL of the Calichef app |
| `MONGODB_URI` | MongoDB for OAuth clients and tokens. The app's cluster works |
| `MCP_DB` | Database name, default `calichef-mcp` |
| `MCP_SECRET` | 32+ random characters, encrypts stored sessions. `openssl rand -base64 48` |
| `ALLOWED_REDIRECT_HOSTS` | Optional, default `claude.ai,claude.com,localhost,127.0.0.1` |

Changing `MCP_SECRET` signs everyone out of the connector.

## Run locally

```bash
nvm use
npm install
cp .env.example .env   # fill it in
npm run dev            # http://localhost:8787/mcp
```

`APP_URL` can point to a local Calichef (`npm run build && npm start` there, so the recipe index exists).

## Deploy on Vercel

1. Deploy Calichef first, so `/data/recipe-index.json` exists in production.
2. Create a Vercel project from this folder and set the variables above (mark `MONGODB_URI` and `MCP_SECRET` as Sensitive).
3. Set `BASE_URL` to the project's production URL and redeploy.
4. In Claude: Settings, Connectors, Add custom connector, paste `https://<your-project>.vercel.app/mcp`, then Connect and sign in.

## Tools

| Area | Tools |
| --- | --- |
| Recipes | `search_recipes`, `get_recipe` |
| My recipes | `list_my_recipes`, `create_recipe`, `update_recipe`, `delete_recipe` |
| Favorites | `list_favorites`, `add_favorite`, `remove_favorite` |
| Shopping list | `get_shopping_list`, `add_to_shopping_list`, `remove_from_shopping_list` |
| Notes and ratings | `set_recipe_note`, `rate_recipe` |
| Account | `whoami` |

New recipes are public by default, like in the app, unless you ask Claude to make them private. `delete_recipe` is marked as destructive for Claude, and only works on your own recipes.
