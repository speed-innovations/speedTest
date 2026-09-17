/**
 * Get the base URL of the application.
 * Works in local dev and on Render or Vercel deployments.
 *
 * Priority:
 * 1. NEXT_PUBLIC_APP_URL (explicit custom domain — preferred on any host)
 * 2. RENDER_EXTERNAL_URL (Render auto-set service URL)
 * 3. VERCEL_PROJECT_PRODUCTION_URL (Vercel auto-set production domain)
 * 4. VERCEL_URL (Vercel deployment URL — preview or production)
 * 5. localhost fallback
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return `http://localhost:${process.env.PORT || 3000}`
}

export function getLoginUrl(): string {
  return `${getBaseUrl()}/login`
}
