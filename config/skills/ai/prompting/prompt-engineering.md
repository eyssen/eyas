---
name: prompt-engineering
description: Prompt engineering fundamentals — structure, clarity, and output control
trigger_patterns:
  - "prompt engineering"
  - "prompt design"
  - "prompt template"
  - "system prompt"
  - "prompt optimization"
capabilities:
  - ai
version: "1.0.0"
---
# Prompt Engineering Fundamentals

## Prompt Structure
1. **Role/Context** — who the AI is and what situation it is in
2. **Task** — clear, specific instruction
3. **Constraints** — format, length, tone, what to avoid
4. **Examples** — input/output pairs for calibration
5. **Output format** — JSON, markdown, specific schema

## Clarity Principles
- Be specific: "List 5 bullet points" not "give me some ideas"
- One task per prompt — complex tasks should be decomposed
- State what to do AND what not to do
- Use delimiters for data: `<input>...</input>`, `---`, triple backticks

## Output Control
```
Respond in the following JSON format:
{
  "summary": "one sentence",
  "key_points": ["point1", "point2"],
  "confidence": 0.0-1.0
}
Do not include any text outside the JSON block.
```

## Iterative Refinement
1. Start with a simple prompt
2. Test with diverse inputs
3. Identify failure cases
4. Add constraints or examples to address failures
5. Repeat until quality threshold met

## Temperature Guide
- `0.0` — deterministic, factual tasks (data extraction, classification)
- `0.3-0.5` — balanced (summarization, analysis)
- `0.7-1.0` — creative tasks (brainstorming, writing)

## Common Mistakes
- Ambiguous instructions ("make it better")
- Too many tasks in one prompt
- Missing edge case handling
- No output format specification
- Assuming the model knows your context

## Evaluation
- Test with 20+ diverse examples
- Measure: accuracy, consistency, format compliance
- Track prompt versions — treat prompts as code
