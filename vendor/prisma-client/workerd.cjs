// workerd (Cloudflare Workers): the generated client's WASM query engine.
// '@prisma/client' must NOT be used here - it resolves to runtime/library.js,
// which calls eval(), and workerd forbids code generation from strings.
module.exports = require('@prisma/client/wasm')
