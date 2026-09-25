---
name: technical-writing
description: Technical writing principles for clear, accurate, and maintainable documentation
trigger_patterns:
  - "technical writing"
  - "write documentation"
  - "technical document"
  - "writing style"
  - "clear writing"
capabilities:
  - technical-documentation
  - style-guidance
  - clarity-improvement
version: "1.0.0"
---
# Technical Writing

## Core Principles
- **Clarity:** one idea per sentence, no ambiguity
- **Brevity:** use the fewest words that convey the meaning
- **Accuracy:** every technical detail must be correct and verifiable
- **Consistency:** same term for the same concept throughout
- **Audience awareness:** write for the reader's knowledge level

## Writing Style
- Use active voice: "The function returns a string" not "A string is returned"
- Use present tense: "This method creates" not "This method will create"
- Use second person for instructions: "You can configure..." or imperative "Configure..."
- Avoid jargon unless your audience expects it — define terms on first use
- One paragraph = one topic

## Document Structure
1. **Title:** clear, descriptive, searchable
2. **Overview:** what this document covers and who it's for
3. **Prerequisites:** what the reader needs before starting
4. **Main content:** logical progression, headings every 2-4 paragraphs
5. **Examples:** concrete, runnable code samples
6. **Troubleshooting:** common problems and solutions
7. **References:** links to related documentation

## Code Examples
- Every example must be tested and runnable
- Include imports and setup — no "assume X is installed"
- Show both input and expected output
- Start simple, then show advanced usage
- Use realistic variable names, not foo/bar

## Review Checklist
- Is every technical claim accurate?
- Can a reader follow the steps without prior context?
- Are all code examples current and tested?
- Are links valid and pointing to the right version?
- Is the reading level appropriate for the audience?
- Does it pass a spell check?

## Common Mistakes
- Writing for yourself instead of the reader
- Assuming too much prior knowledge
- Untested code examples
- Missing error handling in examples
- Outdated screenshots or version references
