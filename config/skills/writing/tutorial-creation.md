---
name: tutorial-creation
description: Creating step-by-step tutorials that teach effectively
trigger_patterns:
  - "tutorial"
  - "step by step"
  - "how to guide"
  - "teach me"
  - "walkthrough"
capabilities:
  - tutorial-writing
  - instructional-design
  - learning-paths
version: "1.0.0"
---
# Tutorial Creation

## Tutorial Structure

### 1. Introduction
- What the reader will build/learn
- Prerequisites (knowledge and tools)
- Estimated time to complete
- Final result preview (screenshot or demo)

### 2. Setup
- Exact commands to set up the environment
- Version numbers for all tools
- Verify setup works before proceeding

### 3. Step-by-Step Instructions
- Each step has a clear goal
- Show the code change, then explain it
- Include expected output after each step
- Provide checkpoints: "At this point, you should see..."

### 4. Complete Code
- Link to full working source code (GitHub repo)
- Include a "final state" the reader can compare against

### 5. Next Steps
- Suggest extensions and exercises
- Link to advanced topics
- Point to related tutorials

## Instructional Design Principles
- **Progressive disclosure:** start simple, add complexity gradually
- **Concrete before abstract:** show the example first, explain the theory after
- **Active learning:** have readers type code, not just read it
- **Scaffolding:** provide working code that readers modify, not blank files
- **Error recovery:** show common mistakes and how to fix them

## Writing for Different Levels

### Beginner
- Explain every new concept when introduced
- Show every command in full (no shortcuts)
- Include file paths and directory structure
- Provide copy-paste ready code blocks

### Intermediate
- Assume basic concepts are known
- Focus on patterns and best practices
- Explain WHY, not just HOW
- Show alternatives and trade-offs

### Advanced
- Focus on edge cases and optimization
- Discuss architecture decisions
- Include performance considerations
- Reference source code and internals

## Quality Checklist
- Follow the tutorial from scratch on a clean machine
- Every code block is tested and produces the stated output
- No unexplained jumps between steps
- All screenshots match the current version
- Someone other than the author has completed it successfully
