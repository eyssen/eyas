---
name: comparison-tables
description: Creating structured comparison tables for technologies, products, and options
trigger_patterns:
  - "compare"
  - "comparison table"
  - "versus"
  - "pros and cons"
  - "which is better"
capabilities:
  - structured-comparison
  - decision-support
  - visualization
version: "1.0.0"
---
# Comparison Tables

## Table Structure

### Basic Feature Comparison
| Criteria | Option A | Option B | Option C |
|----------|----------|----------|----------|
| License | MIT | Apache-2.0 | BSD-3 |
| Stars | 45k | 12k | 8k |
| TypeScript | Native | @types | Native |
| Bundle size | 5kb | 25kb | 12kb |

### Weighted Scoring
| Criteria | Weight | Option A | Score | Option B | Score |
|----------|--------|----------|-------|----------|-------|
| Performance | 30% | Fast | 0.9 | Medium | 0.6 |
| DX | 25% | Great | 0.8 | Good | 0.7 |
| Community | 20% | Large | 0.9 | Small | 0.4 |
| **Total** | | | **0.87** | | **0.57** |

### Pros/Cons Format
**Option A**
- Pros: fast, well-documented, large community
- Cons: large bundle, complex API, steep learning curve

**Option B**
- Pros: simple API, small bundle, easy to learn
- Cons: limited features, small community, fewer plugins

## Best Practices
- Define evaluation criteria BEFORE looking at options
- Use measurable metrics where possible (bundle size, benchmark numbers)
- Include the "do nothing" option as a baseline
- Weight criteria based on project priorities
- Note deal-breakers separately — they override scoring
- Include links to sources for each data point
- Date the comparison — technology changes fast

## Presentation Tips
- Highlight the recommended option
- Bold the winning value in each row
- Include a clear recommendation with reasoning
- Note any caveats or conditions for the recommendation
- Keep to 5-8 criteria — more dilutes the signal

## Common Mistakes
- Comparing apples to oranges (different categories)
- Cherry-picking criteria to favor a predetermined choice
- Ignoring context (what's best depends on the situation)
- Not updating comparisons as options evolve
