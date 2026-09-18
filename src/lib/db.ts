import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool, type PoolConfig } from 'pg'

/**
 * Pool options, and why there are so few of them.
 *
 * The only deviation from pg's defaults is the connection ceiling. Supabase's
 * pooler caps connections for the project as a whole, and a single request here
 * never runs two queries at once, so a low ceiling costs nothing and stops a
 * future Promise.all from fanning out across ten sockets. pg's own idle reaping
 * handles the rest; leave it alone.
 */
function poolOptions(connectionString: string, ssl?: PoolConfig['ssl']): PoolConfig {
  return {
    connectionString,
    max: 3,
    ...(ssl ? { ssl } : {}),
  }
}

// Prisma's default client loads a native query engine binary. The pg driver
// adapter replaces that engine with a pure-JS Postgres driver, which keeps the
// client working against the Supabase pooler without shipping the engine.
function createClient(connectionString: string, ssl?: PoolConfig['ssl']) {
  return new PrismaClient({
    adapter: new PrismaPg(new Pool(poolOptions(connectionString, ssl))),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

// Supabase serves a leaf under its own CA - Supabase Root 2021 CA - which is not
// in any public trust store, so a default handshake fails to verify (self-signed
// in chain) and the only way to talk to it without pinning is to skip
// verification entirely. Instead we pin that root: node builds
// leaf -> intermediate -> this root and checks the *.pooler.supabase.com SAN
// against the host, so the link is both encrypted and authenticated. The cert is
// a public value, carried as base64 in DATABASE_CA_CERT_B64 so it survives a
// single-line env var.
//
// When the var is absent we return undefined and pg connects without TLS. That
// is deliberate: it is the local-Postgres-over-loopback case, which needs no
// TLS. Supabase requires TLS, so a missing cert there surfaces as a connection
// error rather than a silent unverified connection.
function nodeSsl(): PoolConfig['ssl'] | undefined {
  const caB64 = process.env.DATABASE_CA_CERT_B64
  if (!caB64) return undefined
  return {
    ca: Buffer.from(caB64, 'base64').toString('utf8'),
    rejectUnauthorized: true,
  }
}

// A single client on globalThis, so `next dev`'s HMR does not open a new
// connection pool on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function activeClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('No database connection available: DATABASE_URL is not set.')
    globalForPrisma.prisma = createClient(url, nodeSsl())
  }
  return globalForPrisma.prisma
}

// Exported as a proxy so the ~50 call sites keep importing a plain `prisma`
// object while the client behind it is built on first use rather than at import
// time - `next build` imports this module while collecting page data, where
// DATABASE_URL need not be set. Methods are bound to the real client, because a
// proxy as `this` breaks Prisma's internals.
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
