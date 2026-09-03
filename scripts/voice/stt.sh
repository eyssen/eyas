#!/usr/bin/env bash
# EYAS local STT shim — tries common whisper CLIs, falls back with clear error.
# Usage: stt.sh <input-audio> <output-txt> [language]
set -euo pipefail
INPUT="${1:?input audio path}"
OUTPUT="${2:?output txt path}"
LANG="${3:-hu}"

# Strip .txt if present — some CLIs append it themselves
OUT_BASE="${OUTPUT%.txt}"

if command -v whisper-cli >/dev/null 2>&1; then
  whisper-cli -f "$INPUT" -l "$LANG" -otxt -of "$OUT_BASE"
  # whisper-cli writes $OUT_BASE.txt
  if [[ -f "${OUT_BASE}.txt" && "$OUTPUT" != "${OUT_BASE}.txt" ]]; then
    mv "${OUT_BASE}.txt" "$OUTPUT"
  fi
  exit 0
fi

if command -v whisper >/dev/null 2>&1; then
  # openai-whisper python CLI
  whisper "$INPUT" --language "$LANG" --output_format txt --output_dir "$(dirname "$OUTPUT")"
  BASENAME="$(basename "$INPUT")"
  BASENAME="${BASENAME%.*}"
  GENERATED="$(dirname "$OUTPUT")/${BASENAME}.txt"
  if [[ -f "$GENERATED" ]]; then
    mv "$GENERATED" "$OUTPUT"
    exit 0
  fi
fi

if command -v faster-whisper >/dev/null 2>&1; then
  faster-whisper "$INPUT" --language "$LANG" --output_dir "$(dirname "$OUTPUT")"
  exit 0
fi

echo "No STT binary found. Install whisper.cpp (whisper-cli), openai-whisper, or faster-whisper." >&2
exit 127
