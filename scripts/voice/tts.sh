#!/usr/bin/env bash
# EYAS local TTS shim — Piper preferred, espeak-ng fallback.
# Usage: tts.sh <input-txt> <output-ogg> [voice-id]
set -euo pipefail
INPUT="${1:?input text file}"
OUTPUT="${2:?output audio path}"
VOICE="${3:-hu_HU-imre-medium}"

if command -v piper >/dev/null 2>&1; then
  # Prefer a model dir under data/voice/models or ~/.local/share/eyas-voice
  MODEL_DIR="${EYAS_VOICE_MODELS:-$HOME/.local/share/eyas-voice/voices}"
  MODEL="$MODEL_DIR/${VOICE}.onnx"
  if [[ ! -f "$MODEL" ]]; then
    # Try bare voice name as path
    MODEL="$VOICE"
  fi
  WAV="${OUTPUT%.ogg}.wav"
  piper --model "$MODEL" --output_file "$WAV" < "$INPUT"
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -y -i "$WAV" -c:a libopus -b:a 32k "$OUTPUT" >/dev/null 2>&1
    rm -f "$WAV"
  else
    mv "$WAV" "$OUTPUT"
  fi
  exit 0
fi

if command -v espeak-ng >/dev/null 2>&1; then
  WAV="${OUTPUT%.ogg}.wav"
  espeak-ng -f "$INPUT" -w "$WAV"
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -y -i "$WAV" -c:a libopus -b:a 32k "$OUTPUT" >/dev/null 2>&1
    rm -f "$WAV"
  else
    mv "$WAV" "$OUTPUT"
  fi
  exit 0
fi

echo "No TTS binary found. Install Piper (recommended) or espeak-ng." >&2
exit 127
