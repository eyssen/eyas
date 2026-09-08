// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import type { PrivacyConfig, PolicyRule } from './types.js'
import type { ModelRequest, ModelResponse, StreamEvent, ModelGateway } from '@modules/model/types'
import { createScannerChain, type ScannerChain } from './scanner-chain.js'
import { createRegexScanner } from './scanners/regex-scanner.js'
import { createCustomScanner } from './scanners/custom-scanner.js'
import { createNerScanner } from './scanners/ner-scanner.js'
import { applyPolicy, sanitizeText } from './policy-engine.js'
import { createPrivacyRoutes } from './routes.js'
import { readFileSync } from 'fs'
import { parse as parseYaml } from 'yaml'

function loadPrivacyConfig(): PrivacyConfig {
  try {
    const raw = readFileSync('config/personality/privacy.yaml', 'utf-8')
    const parsed = parseYaml(raw)
    return parsed.privacy as PrivacyConfig
  } catch {
    // Defaults if config file is missing
    return {
      enabled: true,
      scanners: ['regex'],
      rules: [
        { pattern: 'personal_id|tax_number|iban', action: 'block' },
        { pattern: 'email|phone', action: 'sanitize' },
        { pattern: 'credit_card|ssn', action: 'block' },
        { pattern: 'custom', action: 'warn' },
      ],
      custom_patterns: [],
      audit: true,
    }
  }
}

/**
 * Structure-aware reference to one scannable piece of text inside a ModelRequest.
 * Keeping a pointer to the *location* instead of offsets inside a concatenated
 * string means replacements cannot drift: each segment is scanned, policied, and
 * optionally sanitized in isolation, then written back to exactly where it came
 * from.
 */
type RequestSegment =
  | { kind: 'system'; text: string }
  | { kind: 'stringMessage'; messageIndex: number; text: string }
  | { kind: 'textBlock'; messageIndex: number; blockIndex: number; text: string }

function collectSegments(request: ModelRequest): RequestSegment[] {
  const segments: RequestSegment[] = []

  if (request.system) {
    segments.push({ kind: 'system', text: request.system })
  }

  request.messages.forEach((msg, messageIndex) => {
    if (typeof msg.content === 'string') {
      segments.push({ kind: 'stringMessage', messageIndex, text: msg.content })
    } else if (Array.isArray(msg.content)) {
      msg.content.forEach((block, blockIndex) => {
        if (block.type === 'text') {
          segments.push({ kind: 'textBlock', messageIndex, blockIndex, text: block.text })
        }
      })
    }
  })

  return segments
}

/**
 * Wrap the model gateway with privacy scanning middleware.
 * Intercepts complete() and stream() to scan outgoing prompts.
 *
 * Exported for unit/regression tests that exercise the scan pipeline without
 * standing up a full module context.
 */
export function wrapGateway(
  gateway: ModelGateway,
  chain: ScannerChain,
  rules: PolicyRule[],
  config: PrivacyConfig,
  ctx: ModuleContext,
): ModelGateway {
  const LOCAL_PROVIDERS = new Set(['ollama'])

  function isLocalProvider(request: ModelRequest): boolean {
    return !!request.provider && LOCAL_PROVIDERS.has(request.provider)
  }

  async function scanRequest(request: ModelRequest): Promise<{
    request: ModelRequest
    blocked: boolean
    reason?: string
  }> {
    // Skip scanning for local providers
    if (isLocalProvider(request)) {
      return { request, blocked: false }
    }

    const segments = collectSegments(request)
    if (segments.length === 0) return { request, blocked: false }

    // Per-segment scan: offsets refer to the segment's own text, so replacing
    // PII in one segment can never shift indices in another. This replaces the
    // previous concatenate-then-slice approach, which drifted whenever a
    // replacement changed length (e.g. 'alice@example.com' → '[EMAIL]').
    type SegmentVerdict = {
      segment: RequestSegment
      sanitizedText?: string
      blocked?: { reason: string }
      routeToLocal?: boolean
    }
    const verdicts: SegmentVerdict[] = []

    for (const segment of segments) {
      if (!segment.text.trim()) {
        verdicts.push({ segment })
        continue
      }

      const matches = await chain.scan(segment.text)
      if (matches.length === 0) {
        verdicts.push({ segment })
        continue
      }

      const result = applyPolicy(segment.text, matches, rules)

      // Audit every match regardless of final verdict — we still want to know
      // what was found.
      if (config.audit) {
        for (const match of matches) {
          const action = result.actions.get(`${match.type}@${match.start}`) || 'warn'
          ctx.bus.emit('eyas.privacy.detected', {
            type: match.type,
            action,
            scanner: match.scanner,
            confidence: match.confidence,
          })
        }
      }

      if (result.blocked) {
        verdicts.push({ segment, blocked: { reason: result.reason ?? 'policy blocked' } })
        continue
      }

      for (const warning of result.warnings) {
        ctx.logger.warn({ warning }, 'Privacy warning')
      }

      verdicts.push({
        segment,
        sanitizedText: result.sanitizedText,
        routeToLocal: result.routeToLocal,
      })
    }

    // Block if any segment blocked. First reason wins — callers only see one.
    const blockedVerdict = verdicts.find(v => v.blocked)
    if (blockedVerdict) {
      return { request, blocked: true, reason: blockedVerdict.blocked!.reason }
    }

    // Route to local if any segment asked for it. Affects the whole request.
    if (verdicts.some(v => v.routeToLocal)) {
      const ollamaProvider = gateway.getProvider('ollama')
      if (ollamaProvider) {
        ctx.logger.warn('Privacy: routing request to local Ollama due to PII detection')
        return {
          request: { ...request, provider: 'ollama' },
          blocked: false,
        }
      }
      ctx.logger.warn('Privacy: auto_local requested but Ollama not available, proceeding with warnings')
    }

    // Apply any sanitizations by segment — each replacement is scoped to its
    // origin and cannot affect neighbouring segments.
    const anySanitized = verdicts.some(v => v.sanitizedText !== undefined)
    if (!anySanitized) {
      return { request, blocked: false }
    }

    const sanitized = applySegmentSanitizations(request, verdicts)
    ctx.logger.info('Privacy: sanitized PII from outgoing request')
    return { request: sanitized, blocked: false }
  }

  return {
    registerProvider: gateway.registerProvider.bind(gateway),
    unregisterProvider: gateway.unregisterProvider.bind(gateway),
    getProvider: gateway.getProvider.bind(gateway),
    listProviders: gateway.listProviders.bind(gateway),
    listAllModels: gateway.listAllModels.bind(gateway),
    // Pass-through: privacy scanning applies to prompts, not embedding inputs.
    // If embed bodies contain PII we trust the upstream caller to have already
    // scrubbed them; treating embeddings identically would require a separate
    // sanitization path we don't have yet.
    embed: gateway.embed.bind(gateway),

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const { request: scannedReq, blocked, reason } = await scanRequest(request)
      if (blocked) {
        throw new Error(`Privacy policy blocked request: ${reason}`)
      }
      return gateway.complete(scannedReq)
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const { request: scannedReq, blocked, reason } = await scanRequest(request)
      if (blocked) {
        yield { type: 'error', error: new Error(`Privacy policy blocked request: ${reason}`) }
        return
      }
      yield* gateway.stream(scannedReq)
    },
  }
}

/**
 * Rebuild a ModelRequest with per-segment sanitized text substituted back in.
 *
 * Each verdict already tells us which segment it came from (system vs. stringMessage
 * vs. textBlock plus its indices), so there is no offset arithmetic and no possibility
 * of length drift between neighbouring segments.
 */
function applySegmentSanitizations(
  request: ModelRequest,
  verdicts: Array<{
    segment: RequestSegment
    sanitizedText?: string
  }>,
): ModelRequest {
  // Build a lookup of replacements keyed by segment identity for O(1) access
  // while reconstructing messages.
  const systemReplacement = verdicts.find(
    v => v.segment.kind === 'system' && v.sanitizedText !== undefined,
  )?.sanitizedText

  // messageIndex -> stringMessage sanitized text
  const stringMessageReplacements = new Map<number, string>()
  // messageIndex -> (blockIndex -> sanitized text)
  const textBlockReplacements = new Map<number, Map<number, string>>()

  for (const v of verdicts) {
    if (v.sanitizedText === undefined) continue
    const s = v.segment
    if (s.kind === 'stringMessage') {
      stringMessageReplacements.set(s.messageIndex, v.sanitizedText)
    } else if (s.kind === 'textBlock') {
      let blocks = textBlockReplacements.get(s.messageIndex)
      if (!blocks) {
        blocks = new Map<number, string>()
        textBlockReplacements.set(s.messageIndex, blocks)
      }
      blocks.set(s.blockIndex, v.sanitizedText)
    }
  }

  const newMessages = request.messages.map((msg, messageIndex) => {
    if (typeof msg.content === 'string') {
      const replacement = stringMessageReplacements.get(messageIndex)
      if (replacement !== undefined && replacement !== msg.content) {
        return { ...msg, content: replacement }
      }
      return msg
    }

    if (Array.isArray(msg.content)) {
      const blockMap = textBlockReplacements.get(messageIndex)
      if (!blockMap) return msg

      const newContent = msg.content.map((block, blockIndex) => {
        if (block.type !== 'text') return block
        const replacement = blockMap.get(blockIndex)
        if (replacement !== undefined && replacement !== block.text) {
          return { ...block, text: replacement }
        }
        return block
      })
      return { ...msg, content: newContent }
    }

    return msg
  })

  const newRequest: ModelRequest = { ...request, messages: newMessages }
  if (systemReplacement !== undefined && systemReplacement !== request.system) {
    newRequest.system = systemReplacement
  }
  return newRequest
}

export const privacyModule: EyasModule = {
  id: 'privacy',
  name: 'Privacy',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'PII scanner chain with policy engine — protects sensitive data before it leaves the system',
  dependencies: ['model'],

  async onRegister(ctx: ModuleContext) {
    ctx.logger.info('Privacy module registered')
  },

  async onStart(ctx: ModuleContext) {
    const config = loadPrivacyConfig()

    if (!config.enabled) {
      ctx.logger.info('Privacy module disabled by config')
      return
    }

    // Build scanner chain
    const chain = createScannerChain()

    if (config.scanners.includes('regex')) {
      chain.addScanner(createRegexScanner())
    }

    if (config.scanners.includes('custom') && config.custom_patterns.length > 0) {
      chain.addScanner(createCustomScanner(config.custom_patterns))
    }

    // NER scanner: auto-detect Ollama availability
    if (config.scanners.includes('ner')) {
      chain.addScanner(createNerScanner())
    } else {
      // Even if not explicitly listed, add NER as optional
      const nerScanner = createNerScanner()
      // NER scanner will return empty results if Ollama is unavailable
      chain.addScanner(nerScanner)
    }

    // Wrap the model gateway with privacy scanning
    const wrappedGateway = wrapGateway(ctx.model, chain, config.rules, config, ctx)
    ctx.model = wrappedGateway

    // A second consumer is what justifies publishing this: durable-memory
    // capture writes model-extracted conversation text to disk, and a
    // redaction applied on read would leave the secret in the file and in
    // the FTS index.
    ;(ctx as any).privacySanitize = async (text: string): Promise<string> => {
      const matches = await chain.scan(text)
      if (matches.length === 0) return text
      return sanitizeText(text, matches, applyPolicy(text, matches, config.rules).actions)
    }

    // Register routes
    createPrivacyRoutes(ctx.http, chain, config.rules, ctx.logger)

    ctx.logger.info(
      { scanners: chain.getScanners().map((s) => s.id), ruleCount: config.rules.length },
      'Privacy module started — gateway wrapped with PII scanning',
    )
  },

  async onStop() {},
}
