/**
 * Template hygiene guards — the silent-failure classes that repeatedly broke
 * the dashboard with zero diagnostics at any layer:
 *
 * 1. '>' inside an @-handler attribute (arrows, comparisons, ternaries)
 *    silently kills the handler (stacksjs/stx#1771).
 * 2. Unbalanced tags: the parser auto-closes at EOF and re-parents following
 *    siblings into the unclosed element — x-show wrappers then hide whole
 *    sections (stacksjs/stx#1769; the blank settings-tabs regression).
 *
 * These rules run over every template in resources/ so the next instance is
 * a red test, not a production screenshot.
 */
import { describe, expect, it } from 'bun:test'
import { Glob } from 'bun'

const ROOT = `${import.meta.dir}/../resources`

async function allTemplates(): Promise<Array<{ path: string, text: string }>> {
  const out: Array<{ path: string, text: string }> = []
  const glob = new Glob('**/*.stx')
  for await (const rel of glob.scan(ROOT)) {
    out.push({ path: `resources/${rel}`, text: await Bun.file(`${ROOT}/${rel}`).text() })
  }
  return out
}

// ---------------------------------------------------------------------------
// Rule 1: no '>' inside @-handler attribute values
// ---------------------------------------------------------------------------
describe('no ">" inside @-handler attributes (stx#1771)', () => {
  it('every event handler is a plain call', async () => {
    const offenders: string[] = []
    for (const { path, text } of await allTemplates()) {
      const re = /@[\w.:-]+="([^"]*)"/g
      let m: RegExpExecArray | null
      // eslint-disable-next-line no-cond-assign
      while ((m = re.exec(text)) !== null) {
        if (m[1].includes('>')) {
          const line = text.slice(0, m.index).split('\n').length
          offenders.push(`${path}:${line} ${m[0].slice(0, 80)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Rule 2: balanced tags per template
// ---------------------------------------------------------------------------
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

function stripNonMarkup(template: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return template
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<script\b[\s\S]*?<\/script>/gi, m => `<script>${blank(m.slice(8, -9))}</script>`)
    .replace(/<style\b[\s\S]*?<\/style>/gi, m => `<style>${blank(m.slice(7, -8))}</style>`)
    .replace(/\{\{[\s\S]*?\}\}/g, blank)
}

function tagImbalances(template: string): string[] {
  const src = stripNonMarkup(template)
  const counts = new Map<string, { opened: number, closed: number }>()
  const tagRe = /<\s*(\/)?\s*([a-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?>/gi
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = tagRe.exec(src)) !== null) {
    const [, closing, rawName, , selfClosing] = m
    const name = rawName.toLowerCase()
    if (VOID_ELEMENTS.has(name) || (!closing && selfClosing))
      continue
    let entry = counts.get(name)
    if (!entry) {
      entry = { opened: 0, closed: 0 }
      counts.set(name, entry)
    }
    if (closing) entry.closed++
    else entry.opened++
  }
  const issues: string[] = []
  for (const [tag, { opened, closed }] of counts) {
    if (opened !== closed)
      issues.push(`<${tag}> opened ${opened}x closed ${closed}x`)
  }
  return issues
}

describe('balanced tags in every template (stx#1769)', () => {
  it('no template has unclosed/over-closed elements', async () => {
    const offenders: string[] = []
    for (const { path, text } of await allTemplates()) {
      // @if/@else branches can legitimately unbalance within a branch —
      // whole-file per-tag totals still balance for every current template.
      const issues = tagImbalances(text)
      if (issues.length > 0)
        offenders.push(`${path}: ${issues.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
