import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// No incremental cache or tag cache is configured: every route in this app is
// either statically prerendered at build time or `force-dynamic`, so there is
// nothing for OpenNext to revalidate. Add an R2/KV cache here if that changes.
export default defineCloudflareConfig()
