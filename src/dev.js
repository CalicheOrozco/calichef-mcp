import app from './app.js'

const port = process.env.PORT || 8787
app.listen(port, () => console.log(`Calichef MCP on http://localhost:${port}/mcp`))
