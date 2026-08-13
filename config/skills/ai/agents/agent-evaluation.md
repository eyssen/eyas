---
name: agent-evaluation
description: AI agent evaluation — benchmarks, metrics, and quality assurance
trigger_patterns:
  - "agent evaluation"
  - "agent testing"
  - "benchmark"
  - "agent quality"
  - "eval"
capabilities:
  - ai
version: "1.0.0"
---
# Agent Evaluation

## Evaluation Dimensions
1. **Task completion** — did the agent achieve the goal?
2. **Accuracy** — are the results correct?
3. **Efficiency** — tokens used, time taken, tool calls count
4. **Safety** — did it follow guardrails, avoid harmful actions?
5. **User experience** — was the interaction natural and helpful?

## Evaluation Framework
```typescript
interface EvalCase {
  id: string;
  input: string;                 // user query or task
  expectedOutput?: string;       // ground truth (if available)
  expectedToolCalls?: string[];  // tools that should be used
  maxSteps?: number;             // efficiency constraint
  assertions: Assertion[];       // custom checks
}

interface Assertion {
  type: 'contains' | 'not_contains' | 'json_matches' | 'custom';
  value: string | object | ((output: string) => boolean);
}
```

## Automated Eval Runner
```typescript
async function runEval(cases: EvalCase[]): Promise<EvalReport> {
  const results = await Promise.all(cases.map(async (c) => {
    const start = Date.now();
    const result = await agent.execute(c.input);
    const duration = Date.now() - start;

    return {
      caseId: c.id,
      passed: c.assertions.every(a => checkAssertion(a, result)),
      tokenCount: result.usage.totalTokens,
      toolCallCount: result.toolCalls.length,
      duration,
    };
  }));

  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    avgTokens: avg(results.map(r => r.tokenCount)),
    avgDuration: avg(results.map(r => r.duration)),
  };
}
```

## LLM-as-Judge
Use a separate model to evaluate response quality:
```typescript
const judgePrompt = `
Rate the following AI response on a scale of 1-5 for:
- Accuracy (factual correctness)
- Completeness (addresses all parts of the query)
- Clarity (well-structured and easy to understand)

Query: ${query}
Response: ${response}

Return JSON: {"accuracy": N, "completeness": N, "clarity": N, "reasoning": "..."}
`;
```

## Regression Testing
- Maintain a test suite of 50-100 representative queries
- Run after every prompt or model change
- Track metrics over time — catch degradation early
- Include adversarial cases (injection attempts, edge cases)

## Best Practices
- Evaluate on real user queries, not synthetic data only
- Use both automated metrics and human evaluation
- Track cost per successful task completion
- Test with different model versions to find cost/quality sweet spot
- Evaluate failure modes — how does the agent fail gracefully?
- Version your eval suite alongside your prompts
