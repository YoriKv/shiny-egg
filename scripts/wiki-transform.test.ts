// Pure wiki-transform pins (wiki-transform.ts) — no filesystem, no network.
// Covers the Obsidian → GitHub-wiki conversion the docs publish relies on:
//   1. image embeds (with/without width) → raw-URL <img>/![]();
//   2. [[Page]] links pass through untouched;
//   3. filename → wiki slug, page ordering, Home/Sidebar generation.
//
// Run: node scripts/wiki-transform.test.ts

import {
  transformMarkdown,
  referencedImages,
  wikiFileName,
  pageTitle,
  orderPages,
  buildHome,
  buildSidebar
} from './wiki-transform.ts'

const REPO = 'YoriKv/shiny-egg'
const RAW = `https://raw.githubusercontent.com/wiki/${REPO}/images`

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

// ── transformMarkdown: image embeds ───────────────────────────────────────────
assert(
  transformMarkdown('![[guide-01.png]]', REPO) === `![guide-01](${RAW}/guide-01.png)`,
  'embed without width → markdown image at the raw wiki URL'
)
assert(
  transformMarkdown('![[first-time-setup-01.png|697]]', REPO) ===
    `<img src="${RAW}/first-time-setup-01.png" width="697" alt="first-time-setup-01">`,
  'embed with width → <img> carrying the width'
)
assert(
  transformMarkdown('before ![[guide-02.png]] after', REPO) ===
    `before ![guide-02](${RAW}/guide-02.png) after`,
  'surrounding text is preserved'
)

// ── transformMarkdown: page links pass through ────────────────────────────────
assert(
  transformMarkdown('see [[First Time Setup]] first', REPO) === 'see [[First Time Setup]] first',
  '[[Page]] wikilinks are left untouched (GitHub renders them)'
)
assert(
  transformMarkdown('[[First Time Setup]] and ![[guide-01.png]]', REPO) ===
    `[[First Time Setup]] and ![guide-01](${RAW}/guide-01.png)`,
  'a page link and an image embed on one line convert independently'
)

// ── referencedImages ──────────────────────────────────────────────────────────
assert(
  JSON.stringify(referencedImages('![[a.png]] x ![[b.png|200]] [[Not An Image]]')) ===
    JSON.stringify(['a.png', 'b.png']),
  'referencedImages: lists embedded images (with + without width), ignores page links'
)

// ── wikiFileName / pageTitle ──────────────────────────────────────────────────
assert(wikiFileName('First Time Setup.md') === 'First-Time-Setup.md', 'wikiFileName: spaces → hyphens, keeps .md')
assert(wikiFileName('Shiny Egg Basics Guide.md') === 'Shiny-Egg-Basics-Guide.md', 'wikiFileName: multi-word')
assert(pageTitle('First Time Setup.md') === 'First Time Setup', 'pageTitle: strips .md, trims')

// ── orderPages: onboarding first, then alpha ──────────────────────────────────
const ordered = orderPages([
  { title: 'Shiny Egg Basics Guide' },
  { title: 'Advanced' },
  { title: 'First Time Setup' }
]).map((p) => p.title)
assert(
  JSON.stringify(ordered) === JSON.stringify(['First Time Setup', 'Advanced', 'Shiny Egg Basics Guide']),
  'orderPages: "First Time Setup" first, rest alphabetical'
)

// ── buildHome / buildSidebar ──────────────────────────────────────────────────
const pages = [{ title: 'Shiny Egg Basics Guide' }, { title: 'First Time Setup' }]
const home = buildHome(pages)
assert(home.startsWith('# Shiny Egg'), 'buildHome: has the landing heading')
assert(
  home.indexOf('[[First Time Setup]]') < home.indexOf('[[Shiny Egg Basics Guide]]'),
  'buildHome: lists onboarding before the guide'
)
const sidebar = buildSidebar(pages)
assert(
  sidebar.includes('[[First Time Setup]]') && sidebar.includes('[[Shiny Egg Basics Guide]]'),
  'buildSidebar: links every page'
)

console.log(failures === 0 ? '\nAll wiki-transform tests passed.' : `\n${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
