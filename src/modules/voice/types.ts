// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Per-agent / global speech reply mode. */
export type VoiceMode = 'text' | 'voice' | 'auto'

export interface VoiceConfig {
  /** Master switch — OFF by default (needs local binaries). */
  enabled: boolean
  /** Default reply mode when no per-agent override exists. */
  defaultMode: VoiceMode
  stt: {
    /** Shell command template. `{input}` and `{output}` are replaced. */
    command: string
    /** Language code passed to STT (e.g. hu, en). */
    language: string
    timeoutMs: number
  }
  tts: {
    command: string
    /** Piper / espeak voice id. */
    voice: string
    timeoutMs: number
  }
  /** Working dir for temp audio files (under data/). */
  workDir: string
}

export interface SttResult {
  text: string
  durationMs: number
}

export interface TtsResult {
  /** Absolute path to the produced audio file (ogg/opus preferred for Telegram). */
  audioPath: string
  durationMs: number
}

export interface VoiceService {
  readonly config: VoiceConfig
  isAvailable(): Promise<{ stt: boolean; tts: boolean }>
  transcribe(audioPath: string): Promise<SttResult>
  synthesize(text: string, opts?: { voice?: string }): Promise<TtsResult>
  resolveMode(agentId: string | null, inboundWasVoice: boolean): VoiceMode
  setAgentMode(agentId: string, mode: VoiceMode): void
  getAgentMode(agentId: string): VoiceMode | null
}
