/** @type {import('next').NextConfig} */
const nextConfig = {
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
