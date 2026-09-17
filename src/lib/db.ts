import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Prisma's default client loads a native query engine binary, which workerd
// cannot execute — importing it crashed every route on Cloudflare. The pg
// driver adapter replaces that engine with a pure-JS Postgres driver, so the
// same client works on Workers and on Node. The Pool constructor opens no
// socket, so this is safe to run at module scope inside a Worker isolate.
function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  return new PrismaClient({
    adapter: new PrismaPg(pool),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
