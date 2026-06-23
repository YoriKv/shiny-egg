import { defineConfig } from 'vitest/config'

// Vitest covers the RENDERER logic tests only — fast, pure reducer/graph logic
// in a node env. The engine/main tests under snes-framework/scripts/**/*.test.ts
// run with `node --test` (they use a custom assert harness + call process.exit,
// which would abort a Vitest run), so they are deliberately NOT matched here.
//
// The one engine test written for Vitest — the render-parity regression
// (snes-framework/scripts/engine/render-parity.vitest.test.ts) — is kept OUT of
// this default run on purpose: it pulls in the whole engine render module graph
// (≈20 s of Vite transform) and renders 219 levels, so folding it in would tax
// every `test:renderer`/CI run even where it skips. It has its own config +
// `test:render-parity` script (vitest.render-parity.config.ts).
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
