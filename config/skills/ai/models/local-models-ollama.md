---
name: local-models-ollama
description: Running local AI models with Ollama — setup, usage, and optimization
trigger_patterns:
  - "ollama"
  - "local model"
  - "self hosted"
  - "local llm"
  - "offline ai"
capabilities:
  - ai
version: "1.0.0"
sources:
  - name: Ollama
    url: https://github.com/ollama/ollama
    license: MIT
---
# Local Models with Ollama

## Setup
```bash
# Install
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull llama3.1:8b          # general purpose
ollama pull codellama:13b         # code generation
ollama pull nomic-embed-text      # embeddings
ollama pull mxbai-embed-large     # higher quality embeddings
```

## API Usage
```typescript
// Chat completion
const response = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    model: 'llama3.1:8b',
    messages: [{ role: 'user', content: 'Explain async/await' }],
    stream: false,
  }),
});

// Embedding
const embResponse = await fetch('http://localhost:11434/api/embed', {
  method: 'POST',
  body: JSON.stringify({
    model: 'nomic-embed-text',
    input: 'Text to embed',
  }),
});
```

## AI SDK Integration
```typescript
import { ollama } from 'ollama-ai-provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: ollama('llama3.1:8b'),
  prompt: 'Write a TypeScript function to sort an array',
});
```

## Model Selection for Local
| Model | Size | Use Case | RAM Required |
|-------|------|----------|-------------|
| llama3.1:8b | 4.7GB | General chat, simple tasks | 8GB |
| codellama:13b | 7.4GB | Code generation | 16GB |
| mistral:7b | 4.1GB | Fast general purpose | 8GB |
| nomic-embed-text | 274MB | Text embeddings (768d) | 1GB |
| mxbai-embed-large | 670MB | Better embeddings (1024d) | 2GB |

## Docker Compose
```yaml
services:
  ollama:
    image: ollama/ollama:latest
    ports: ["11434:11434"]
    volumes: ["ollama_data:/root/.ollama"]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

## Performance Tips
- Use quantized models (Q4_K_M) for speed with acceptable quality
- Keep frequently used models loaded: `ollama run model --keepalive 24h`
- GPU acceleration significantly improves speed (CUDA, Metal)
- For embedding-only workloads, small models are sufficient

## When to Use Local vs Cloud
- **Local**: development, testing, sensitive data, offline, cost control
- **Cloud**: production, complex reasoning, large context, best quality
- **Hybrid**: local for simple tasks, cloud fallback for complex ones
