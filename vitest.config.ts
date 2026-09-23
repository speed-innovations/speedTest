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
    // One database, shared by every integration suite in here. Running the
    // files in parallel means one suite's fixtures land in another's
    // aggregates: a global SUM, a "count past retention" delta, or - once
    // Part 11 added a sweep that DELETES expired assets - another suite's
    // fixtures vanishing mid-test. That produced four separate intermittent
    // failures before this line existed, each of which reads like a real bug.
    //
    // Sequential files cost a few seconds and buy determinism. Tests within a
    // file still run in order as usual.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
