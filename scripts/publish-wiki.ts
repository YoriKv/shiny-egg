// Build GitHub-wiki content from docs/ into a target directory (a checked-out
// wiki repo). Transforms each docs/*.md from Obsidian flavor to wiki markdown
// (wiki-transform.ts), copies docs/images/ across, and generates Home + _Sidebar
// navigation. It does NOT touch git — the Release workflow clones the wiki, runs
// this, then commits + pushes (see .github/workflows/release.yml).
//
// Usage:
//   node scripts/publish-wiki.ts --out <wikiDir> [--src docs] [--repo owner/name]
//
// Local run (manual publish): clone the wiki, build into it, commit, push:
//   git clone https://github.com/YoriKv/shiny-egg.wiki.git /tmp/wiki
//   node scripts/publish-wiki.ts --out /tmp/wiki
//   cd /tmp/wiki && git add -A && git commit -m "Docs sync" && git push

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildHome,
  buildSidebar,
  pageTitle,
  referencedImages,
  transformMarkdown,
  wikiFileName,
  type WikiPage
} from './wiki-transform.ts'

const DEFAULT_REPO = 'YoriKv/shiny-egg'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const src = flag('src') ?? 'docs'
const out = flag('out')
const repo = flag('repo') ?? DEFAULT_REPO

if (!out) {
  console.error('publish-wiki: --out <wikiDir> is required (the checked-out wiki repo).')
  process.exit(2)
}
if (!existsSync(src)) {
  console.error(`publish-wiki: source docs dir not found: ${src}`)
  process.exit(2)
}

const docFiles = readdirSync(src).filter((f) => f.toLowerCase().endsWith('.md'))
if (docFiles.length === 0) {
  console.error(`publish-wiki: no .md files in ${src}`)
  process.exit(2)
}

mkdirSync(out, { recursive: true })

// 1. Transform each doc → a wiki page file. Also collect referenced images so we
//    can flag any broken embeds before publishing.
const imagesSrc = join(src, 'images')
const pages: WikiPage[] = []
const missingImages: string[] = []
for (const file of docFiles) {
  const md = readFileSync(join(src, file), 'utf8')
  for (const img of referencedImages(md)) {
    if (!existsSync(join(imagesSrc, img))) missingImages.push(`${file} → ${img}`)
  }
  writeFileSync(join(out, wikiFileName(file)), transformMarkdown(md, repo), 'utf8')
  pages.push({ title: pageTitle(file) })
}

// 2. Refresh images/ wholesale (a clean copy so deleted images don't linger).
if (existsSync(imagesSrc)) {
  rmSync(join(out, 'images'), { recursive: true, force: true })
  cpSync(imagesSrc, join(out, 'images'), { recursive: true })
}

// 3. Generated navigation.
writeFileSync(join(out, 'Home.md'), buildHome(pages), 'utf8')
writeFileSync(join(out, '_Sidebar.md'), buildSidebar(pages), 'utf8')

// Summary.
console.log(`publish-wiki: ${pages.length} page(s) → ${out} (repo ${repo})`)
for (const p of pages) console.log(`  • ${p.title}  (${wikiFileName(`${p.title}.md`)})`)
if (missingImages.length > 0) {
  // Warn, don't fail: a missing image is a broken embed, but shouldn't block the
  // rest of the docs from publishing.
  console.warn(`publish-wiki: WARNING — ${missingImages.length} referenced image(s) missing from ${imagesSrc}:`)
  for (const m of missingImages) console.warn(`  ! ${m}`)
}
