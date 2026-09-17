/**
 * Get the base URL of the application.
 * Works in both local dev and Vercel deployment.
 *
 * Priority:
 * 1. NEXT_PUBLIC_APP_URL (explicit custom domain)
 * 2. VERCEL_PROJECT_PRODUCTION_URL (Vercel auto-set production domain)
 * 3. VERCEL_URL (Vercel deployment URL — preview or production)
 * 4. localhost fallback
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return `http://localhost:${process.env.PORT || 3000}`
}

export function getLoginUrl(): string {
  return `${getBaseUrl()}/login`
}
