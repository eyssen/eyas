// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { resolve as resolvePath } from 'path'
import { createRequire } from 'module'
import { FALLBACK_FUNCTION_REGEX, FALLBACK_CLASS_REGEX, getLanguageConfig } from './language-map.js'

export interface CodeChunk {
  content: string
  symbolName: string
  symbolType: 'function' | 'class' | 'imports' | 'top-level' | 'outline'
  lineStart: number
  lineEnd: number
}

const LARGE_CLASS_THRESHOLD = 150

// ─── TreeSitter AST-based chunker ────────────────────────────────────────────

// Lazy-init state for web-tree-sitter
let parserInitialized = false
let Parser: any = null

async function initParser(): Promise<void> {
  if (parserInitialized) return
  try {
    const mod = await import('web-tree-sitter')
    Parser = mod.default ?? mod
    await Parser.init()
    parserInitialized = true
  } catch {
    Parser = null
    parserInitialized = true
  }
}

/**
 * Resolve the absolute path to a WASM grammar file.
 * Tries multiple strategies for Bun + Node.js compatibility.
 */
function resolveWasmPath(grammarRelPath: string): string | null {
  // Strategy 1: require.resolve via createRequire
  try {
    const require = createRequire(import.meta.url)
    return require.resolve(grammarRelPath)
  } catch {
    // fall through
  }
  // Strategy 2: derive from node_modules relative to this file.
  // grammarRelPath comes exclusively from the hardcoded LANGUAGES table in language-map.ts
  // (e.g. "tree-sitter-wasms/out/tree-sitter-typescript.wasm") — never from user input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  try {
    // __dirname equivalent
    const thisFile = new URL(import.meta.url).pathname
    const projectRoot = resolvePath(thisFile, '../../../../..') // src/modules/search/indexers/code → project root
    return resolvePath(projectRoot, 'node_modules', grammarRelPath) // nosemgrep
  } catch {
    return null
  }
}

/**
 * Extract symbol name from a TreeSitter node.
 * Looks for `name` or `identifier` child nodes.
 */
function extractSymbolName(node: any): string | undefined {
  const nameNode =
    node.childForFieldName?.('name') ??
    node.children?.find((c: any) => c.type === 'identifier' || c.type === 'name')
  return nameNode?.text
}

/**
 * AST-based chunker using web-tree-sitter WASM.
 * Returns null if TreeSitter is unavailable (use regex fallback then).
 */
export async function chunkCodeAST(
  code: string,
  filename: string,
  language: string,
): Promise<CodeChunk[] | null> {
  await initParser()
  if (!Parser) return null

  const langConfig = getLanguageConfig(language)
  if (!langConfig) return null

  const wasmPath = resolveWasmPath(langConfig.grammar)
  if (!wasmPath) return null

  let tsLanguage: any
  try {
    tsLanguage = await Parser.Language.load(wasmPath)
  } catch {
    return null
  }

  let tree: any
  try {
    const parser = new Parser()
    parser.setLanguage(tsLanguage)
    tree = parser.parse(code)
  } catch {
    return null
  }

  const lines = code.split('\n')
  const chunks: CodeChunk[] = []
  const functionNodeTypes = new Set(langConfig.functionNodes)
  const classNodeTypes = new Set(langConfig.classNodes)

  // --- Imports chunk ---
  let importEnd = -1
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ') ||
      trimmed.startsWith('require(') ||
      (trimmed.startsWith('const ') && trimmed.includes('require('))
    ) {
      importEnd = i
    } else if (importEnd >= 0 && trimmed !== '') {
      break
    }
  }
  if (importEnd >= 0) {
    chunks.push({
      content: lines.slice(0, importEnd + 1).join('\n'),
      symbolName: 'imports',
      symbolType: 'imports',
      lineStart: 1,
      lineEnd: importEnd + 1,
    })
  }

  // --- Walk AST for function/class nodes ---
  function walk(node: any) {
    const isFunction = functionNodeTypes.has(node.type)
    const isClass = classNodeTypes.has(node.type)

    if (isFunction || isClass) {
      const symbolName = extractSymbolName(node)
      const symbolType: CodeChunk['symbolType'] = isClass ? 'class' : 'function'

      // Line numbers from TreeSitter are 0-indexed
      let lineStart = node.startPosition.row
      const lineEnd = node.endPosition.row

      // Check for decorator as previous named sibling
      let prevSibling = node.previousNamedSibling
      while (
        prevSibling &&
        (prevSibling.type === 'decorator' || prevSibling.type === 'attribute')
      ) {
        lineStart = prevSibling.startPosition.row
        prevSibling = prevSibling.previousNamedSibling
      }

      const content = lines.slice(lineStart, lineEnd + 1).join('\n')
      const lineCount = lineEnd - lineStart + 1

      chunks.push({
        content,
        symbolName: symbolName ?? '',
        symbolType,
        lineStart: lineStart + 1,  // 1-indexed
        lineEnd: lineEnd + 1,
      })

      // Large class: also emit outline chunk + recurse into methods
      if (isClass && lineCount > LARGE_CLASS_THRESHOLD) {
        const outlineLines: string[] = []
        for (let j = lineStart; j <= lineEnd; j++) {
          const t = lines[j].trim()
          if (j === lineStart || t.match(FALLBACK_FUNCTION_REGEX) || t.startsWith('@')) {
            outlineLines.push(lines[j])
          }
        }
        chunks.push({
          content: outlineLines.join('\n'),
          symbolName: `${symbolName ?? ''} (outline)`,
          symbolType: 'outline',
          lineStart: lineStart + 1,
          lineEnd: lineEnd + 1,
        })
        // Recurse into the class body to extract methods
        for (const child of node.children ?? []) {
          walk(child)
        }
        return // don't double-recurse below
      }

      // For functions inside classes (not large), skip recursion
      if (isFunction) return
    }

    // Recurse into children
    for (const child of node.children ?? []) {
      walk(child)
    }
  }

  walk(tree.rootNode)

  // Sort by line number
  chunks.sort((a, b) => a.lineStart - b.lineStart)

  return chunks
}

/**
 * Detects Python indent-based scope end.
 * Returns the last line index (inclusive) that belongs to the block
 * starting at `startLine` with base indent `baseIndent`.
 */
function findPythonBlockEnd(lines: string[], startLine: number, baseIndent: number): number {
  let end = startLine
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      // blank lines are allowed inside a block — keep looking
      continue
    }
    const indent = line.search(/\S/)
    if (indent <= baseIndent) {
      // back at same or less indent — block ended before this line
      break
    }
    end = i
  }
  return end
}

/**
 * Detects brace-based block end (TypeScript / JavaScript / Java / Go / Rust).
 * Counts `{` and `}` starting from `startLine`.
 */
function findBraceBlockEnd(lines: string[], startLine: number): number {
  let depth = 0
  let started = false

  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true }
      else if (ch === '}') { depth-- }
    }
    if (started && depth === 0) return i
  }
  // No closing brace found — return last line
  return lines.length - 1
}

/**
 * Regex-based fallback chunker. Handles ~90% of cases without TreeSitter.
 * TreeSitter WASM upgrade in Task 17.
 */
export function chunkCodeFallback(
  code: string,
  filename: string,
  language: string,
): CodeChunk[] {
  const lines = code.split('\n')
  const chunks: CodeChunk[] = []
  const isPython = language === 'python'

  // Track which lines have been assigned to a chunk
  const covered = new Set<number>()

  // --- Pass 1: collect import region at top ---
  let importEnd = -1
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ') ||
      trimmed.startsWith('require(') ||
      trimmed.startsWith('const ') && trimmed.includes('require(')
    ) {
      importEnd = i
    } else if (importEnd >= 0 && trimmed !== '') {
      // First non-blank, non-import line after imports found — stop
      break
    }
  }

  if (importEnd >= 0) {
    const content = lines.slice(0, importEnd + 1).join('\n')
    chunks.push({
      content,
      symbolName: 'imports',
      symbolType: 'imports',
      lineStart: 1,
      lineEnd: importEnd + 1,
    })
    for (let i = 0; i <= importEnd; i++) covered.add(i)
  }

  // --- Pass 2: scan for class/function declarations ---
  let i = 0
  while (i < lines.length) {
    if (covered.has(i)) { i++; continue }

    const line = lines[i]
    const trimmed = line.trim()

    // Collect decorators (lines starting with @)
    let decoratorStart = i
    while (decoratorStart > 0 && lines[decoratorStart - 1].trim().startsWith('@')) {
      decoratorStart--
    }

    const classMatch = trimmed.match(FALLBACK_CLASS_REGEX)
    const fnMatch = classMatch ? null : trimmed.match(FALLBACK_FUNCTION_REGEX)

    if (classMatch || fnMatch) {
      const symbolName = (classMatch ?? fnMatch)?.[1] ?? ''
      const symbolType: CodeChunk['symbolType'] = classMatch ? 'class' : 'function'

      // Find block end
      let blockEnd: number
      if (isPython) {
        const indent = line.search(/\S/)
        blockEnd = findPythonBlockEnd(lines, i, indent)
      } else {
        blockEnd = findBraceBlockEnd(lines, i)
      }

      const chunkStart = decoratorStart
      const content = lines.slice(chunkStart, blockEnd + 1).join('\n')
      const lineCount = blockEnd - chunkStart + 1

      chunks.push({
        content,
        symbolName,
        symbolType,
        lineStart: chunkStart + 1,  // 1-indexed
        lineEnd: blockEnd + 1,
      })

      // Mark lines covered (including decorators)
      for (let j = chunkStart; j <= blockEnd; j++) covered.add(j)

      // For large classes, also emit an outline chunk
      if (symbolType === 'class' && lineCount > LARGE_CLASS_THRESHOLD) {
        const outlineLines: string[] = []
        for (let j = chunkStart; j <= blockEnd; j++) {
          const t = lines[j].trim()
          if (
            j === chunkStart ||
            t.match(FALLBACK_FUNCTION_REGEX) ||
            t.startsWith('@')
          ) {
            outlineLines.push(lines[j])
          }
        }
        chunks.push({
          content: outlineLines.join('\n'),
          symbolName: `${symbolName} (outline)`,
          symbolType: 'outline',
          lineStart: chunkStart + 1,
          lineEnd: blockEnd + 1,
        })
      }

      i = blockEnd + 1
      continue
    }

    i++
  }

  // --- Pass 3: collect uncovered non-blank lines as top-level chunks ---
  let topStart: number | null = null
  const flushTopLevel = (end: number) => {
    if (topStart === null) return
    const content = lines.slice(topStart, end).join('\n').trim()
    if (content) {
      chunks.push({
        content,
        symbolName: 'top-level',
        symbolType: 'top-level',
        lineStart: topStart + 1,
        lineEnd: end,
      })
    }
    topStart = null
  }

  for (let j = 0; j < lines.length; j++) {
    if (!covered.has(j) && lines[j].trim() !== '') {
      if (topStart === null) topStart = j
    } else if (topStart !== null && (covered.has(j) || j === lines.length - 1)) {
      flushTopLevel(j)
    }
  }
  flushTopLevel(lines.length)

  // Sort by line number
  chunks.sort((a, b) => a.lineStart - b.lineStart)

  return chunks
}
