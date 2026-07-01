// Pure Obsidian-markdown → GitHub-wiki-markdown transforms for the docs/ tutorial.
// No filesystem or Node APIs, so it's trivially unit-testable (wiki-transform.test.ts);
// the CLI that applies it + copies assets is publish-wiki.ts.
//
// Two Obsidian-isms appear in docs/:
//   - image embeds  ![[file.png]]  and  ![[file.png|WIDTH]]
//   - page links    [[Page Name]]
// GitHub wiki renders [[Page Name]] natively (→ the page whose file is
// `Page-Name.md`), so those pass through untouched. The image embeds are
// Obsidian-only and must be rewritten.

/**
 * Raw-content base for a repo's wiki. GitHub serves wiki blobs at
 * `raw.githubusercontent.com/wiki/<owner>/<repo>/<path>`. We embed images by this
 * ABSOLUTE raw URL rather than a relative path because GitHub resolves relative
 * image links against the rendered PAGE url (…/wiki/Page-Name), not the wiki repo
 * root — so a relative `images/x.png` 404s. `repo` is "owner/name".
 */
export function wikiRawBase(repo: string): string {
  return `https://raw.githubusercontent.com/wiki/${repo}`
}

/**
 * Doc basename → GitHub wiki page-file name: strip `.md`, spaces → hyphens, re-add
 * `.md`. "First Time Setup.md" → "First-Time-Setup.md". GitHub derives the page
 * title back by turning hyphens into spaces, so a `[[First Time Setup]]` link
 * resolves to this file.
 */
export function wikiFileName(docBaseName: string): string {
  return `${pageTitle(docBaseName).replace(/\s+/g, '-')}.md`
}

/** Human page title from a doc basename: "First Time Setup.md" → "First Time Setup". */
export function pageTitle(docBaseName: string): string {
  return docBaseName.replace(/\.md$/i, '').trim()
}

// One matcher for image embeds: filename (no ] or |) + optional |width.
const IMAGE_EMBED = /!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/g

/**
 * Convert one doc's Obsidian markdown to GitHub-wiki markdown:
 *   `![[img.png|W]]` → `<img src="RAW/images/img.png" width="W" alt="img">`
 *   `![[img.png]]`   → `![img](RAW/images/img.png)`
 *   `[[Page Name]]`  → unchanged (GitHub wiki renders wikilinks)
 * `repo` is the "owner/name" that owns the wiki (for the image raw URLs).
 */
export function transformMarkdown(md: string, repo: string): string {
  const imgBase = `${wikiRawBase(repo)}/images`
  return md.replace(IMAGE_EMBED, (_m, file: string, width?: string) => {
    const name = file.trim()
    const url = `${imgBase}/${encodeURIComponent(name)}`
    const alt = name.replace(/\.[a-z0-9]+$/i, '')
    return width ? `<img src="${url}" width="${width}" alt="${alt}">` : `![${alt}](${url})`
  })
}

/** Image filenames referenced by `![[…]]` embeds in a doc (for existence checks). */
export function referencedImages(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(IMAGE_EMBED)) out.push(m[1]!.trim())
  return out
}

export interface WikiPage {
  /** Display title, e.g. "First Time Setup". */
  title: string
}

/** Nav order: onboarding ("First Time Setup") first, then alphabetical. */
export function orderPages(pages: WikiPage[]): WikiPage[] {
  const rank = (t: string): number => (/first\s*time\s*setup/i.test(t) ? 0 : 1)
  return [...pages].sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title))
}

/** `_Sidebar.md` — shown alongside every wiki page. */
export function buildSidebar(pages: WikiPage[]): string {
  const items = orderPages(pages).map((p) => `- [[${p.title}]]`)
  return `### Shiny Egg\n\n${items.join('\n')}\n`
}

/** `Home.md` — the wiki landing page: intro + a contents index. */
export function buildHome(pages: WikiPage[]): string {
  const items = orderPages(pages).map((p) => `- [[${p.title}]]`)
  return (
    `# Shiny Egg\n\n` +
    `A Yoshi's Island (SNES) level editor. This wiki is the usage tutorial.\n\n` +
    `## Contents\n\n${items.join('\n')}\n`
  )
}
