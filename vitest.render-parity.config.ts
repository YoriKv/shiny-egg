import { defineConfig } from 'vitest/config'

// Dedicated config for the engine render-parity regression test (run via
// `pnpm test:render-parity`). Kept separate from vitest.config.ts so the fast
// renderer-logic suite (`test:renderer`) isn't taxed by this test's heavy engine
// module graph (~20 s Vite transform) + 219-level render. Gated on the V1.0
// build: skips cleanly when the build artifacts are absent. See the test file
// header and snes-framework/scripts/engine/render-parity.ts for the model.
export default defineConfig({
  test: {
    include: ['snes-framework/scripts/**/*.vitest.test.ts'],
    environment: 'node',
    // Rendering all 219 levels in beforeAll is the cost; give the hook room.
    hookTimeout: 180_000,
    testTimeout: 30_000
  }
})
