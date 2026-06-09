import { defineConfig } from 'vitest/config'

// Vitest covers the RENDERER logic tests only. The engine/main tests under
// snes-framework/scripts/** run with `node --test` (they use explicit `.ts`
// import specifiers + a custom assert harness, and call process.exit — which
// would abort a Vitest run), so they are deliberately NOT matched here.
//
// Renderer modules use Vite-style EXTENSIONLESS relative imports, which Vitest
// resolves natively (Node's bare `--test` cannot). The tested modules are pure
// logic (no DOM at import or call time), so the node environment is enough — no
// jsdom needed.
export default defineConfig({
  test: {
    include: ['src/renderer/src/**/*.test.ts'],
    environment: 'node'
  }
})
