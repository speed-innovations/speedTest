import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default: most of this suite is pure logic and does not want a DOM.
    // Files that need one opt in with a `// @vitest-environment jsdom` docblock,
    // rather than environmentMatchGlobs, which is deprecated in Vitest 3.
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
