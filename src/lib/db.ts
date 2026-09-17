// '@app/prisma-client' (vendor/prisma-client) picks the engine by runtime
// condition: WASM on workerd, native on Node. Importing '@prisma/client'
// directly here lands on runtime/library.js in the OpenNext build - esbuild
// uses the `node` platform, and Prisma's generated condition map lists `node`
// ahead of `workerd` - and that file calls eval(), which workerd forbids.
import { PrismaClient } from '@app/prisma-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { getCloudflareContext } from '@opennextjs/cloudflare'

// Prisma's default client loads a native query engine binary, which workerd
// cannot execute. The pg driver adapter replaces that engine with a pure-JS
// Postgres driver, so the same client works on Workers and on Node.
/**
 * Pool options, and why there are so few of them.
 *
 * On workerd the pool lives for exactly one request, and anything that keeps a
 * socket alive past the response keeps the request alive too: with
 * `idleTimeoutMillis: 0` every login hung until the runtime cancelled it with
 * "your Worker's code had hung and would never generate a response". Timers
 * armed by `query_timeout` are worse - they are bound to the I/O context of the
 * request that armed them, and firing in a later one produces "closure invoked
 * recursively or after being dropped".
 *
 * So the only deviation from pg's defaults is the connection ceiling. pg's own
 * idle reaping is what lets the request finish; leave it alone.
 */
function poolOptions(connectionString: string) {
  return {
    connectionString,
    // On workerd this pool serves one request and that request never runs two
    // queries at once, so the ceiling only exists to stop a future Promise.all
    // from fanning out; pg's default of 10 would let a single request hold ten
    // sockets through Hyperdrive, and Hyperdrive caps origin connections at 20.
    max: 3,
  }
}

// Prisma's default client loads a native query engine binary, which workerd
// cannot execute. The pg driver adapter replaces that engine with a pure-JS
// Postgres driver, so the same client works on Workers and on Node.
function createClient(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg(new Pool(poolOptions(connectionString))),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}
type HyperdriveBinding = { connectionString?: string }

// Returns the Hyperdrive binding when running on workerd, null everywhere else.
// getCloudflareContext() throws outside a request context (next dev, the seed
// script, vitest), which is the signal to fall back to DATABASE_URL.
function hyperdrive(): { binding: HyperdriveBinding; requestKey: object } | null {
  try {
    const cf = getCloudflareContext()
    const binding = (cf?.env as Record<string, unknown> | undefined)
      ?.HYPERDRIVE as HyperdriveBinding | undefined

    if (!binding?.connectionString) return null

    // `ctx` is a fresh ExecutionContext per invocation, so it identifies the
    // current request. Falling back to `cf` only loses per-request isolation,
    // never correctness of the lookup itself.
    return { binding, requestKey: (cf.ctx as object | undefined) ?? cf }
  } catch {
    return null
  }
}

// One client per request on workerd. A pool held at module scope survives into
// the next request, and workerd refuses to let a socket opened in an earlier
// request be reused ("Cannot perform I/O on behalf of a different request"),
// so the second request onwards would fail. Keyed by the per-request context
// object and held weakly, so it is collected with the request.
const perRequestClients = new WeakMap<object, PrismaClient>()

// Node keeps a single client on globalThis, so `next dev`'s HMR does not open a
// new connection pool on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function activeClient(): PrismaClient {
  const cf = hyperdrive()

  if (cf) {
    let client = perRequestClients.get(cf.requestKey)
    if (!client) {
      client = createClient(cf.binding.connectionString!)
      perRequestClients.set(cf.requestKey, client)
    }
    return client
  }

  if (!globalForPrisma.prisma) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error(
        'No database connection available: the HYPERDRIVE binding is missing and DATABASE_URL is not set.'
      )
    }
    globalForPrisma.prisma = createClient(url)
  }
  return globalForPrisma.prisma
}

// Exported as a proxy so the ~50 call sites keep importing a plain `prisma`
// object while the client behind it is resolved per request. Methods are bound
// to the real client, because a proxy as `this` breaks Prisma's internals.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = activeClient()
    const value = Reflect.get(client, property) as unknown
    return typeof value === 'function' ? value.bind(client) : value
  },
  has(_target, property) {
    return Reflect.has(activeClient(), property)
  },
})
