/** @type {import('next').NextConfig} */
const nextConfig = {
  // '@app/prisma-client' must stay an unresolved require in the server output:
  // webpack would resolve it under the `node` condition at build time and bake in
  // the native engine, and the OpenNext esbuild pass has to be the one that picks
  // the branch. `serverExternalPackages` does not cover it - the shim is a `file:`
  // dependency, so it resolves to vendor/prisma-client, outside node_modules, and
  // Next's heuristic skips it. This rule runs ahead of Next's own externals and is
  // unconditional, so it does not depend on that heuristic.
  webpack: (config, { isServer }) => {
    if (!isServer) return config

    const existing = Array.isArray(config.externals)
      ? config.externals
      : [config.externals].filter(Boolean)

    config.externals = [
      ({ request }, callback) =>
        request === '@app/prisma-client'
          ? callback(null, 'commonjs @app/prisma-client')
          : callback(),
      ...existing,
    ]

    return config
  },
  images: {
    // next/image is not used anywhere in this app. Leaving the Image
    // Optimization API enabled with `remotePatterns: hostname: '**'` exposed
    // /_next/image as an open image proxy, which is the attack surface for the
    // outstanding AVIF RCE (GHSA-2xp9-vwfh-vxw4) and the optimizer SSRF/DoS
    // advisories. Disabling optimization removes that endpoint's remote fetch.
    // If next/image is adopted later, re-enable this and replace the wildcard
    // with an explicit allow-list of hostnames.
    unoptimized: true,
  },
}

module.exports = nextConfig
