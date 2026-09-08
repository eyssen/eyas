// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface LanguageConfig {
  grammar: string
  treeSitterLang: string
  functionNodes: string[]
  classNodes: string[]
}

const LANGUAGES: Record<string, LanguageConfig> = {
  typescript: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-typescript.wasm',
    treeSitterLang: 'typescript',
    functionNodes: ['function_declaration', 'method_definition', 'arrow_function', 'function'],
    classNodes: ['class_declaration'],
  },
  javascript: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-javascript.wasm',
    treeSitterLang: 'javascript',
    functionNodes: ['function_declaration', 'method_definition', 'arrow_function', 'function'],
    classNodes: ['class_declaration'],
  },
  python: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
    treeSitterLang: 'python',
    functionNodes: ['function_definition'],
    classNodes: ['class_definition'],
  },
  go: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-go.wasm',
    treeSitterLang: 'go',
    functionNodes: ['function_declaration', 'method_declaration'],
    classNodes: [],
  },
  rust: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-rust.wasm',
    treeSitterLang: 'rust',
    functionNodes: ['function_item'],
    classNodes: ['struct_item', 'impl_item'],
  },
  java: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-java.wasm',
    treeSitterLang: 'java',
    functionNodes: ['method_declaration', 'constructor_declaration'],
    classNodes: ['class_declaration'],
  },
}

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
}

export function getLanguageForExtension(ext: string): string | null {
  return EXTENSION_MAP[ext] ?? null
}

export function getLanguageConfig(language: string): LanguageConfig | null {
  return LANGUAGES[language] ?? null
}

export function isTreeSitterSupported(ext: string): boolean {
  return ext in EXTENSION_MAP
}

export const FALLBACK_FUNCTION_REGEX = /^(?:export\s+)?(?:async\s+)?(?:function|def|fn|func|fun|sub|proc|method)\s+(\w+)/
export const FALLBACK_CLASS_REGEX = /^(?:export\s+)?(?:abstract\s+)?(?:class|struct|interface|trait|enum|type)\s+(\w+)/
