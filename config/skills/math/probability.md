---
name: probability
description: Probability theory fundamentals and practical applications
trigger_patterns:
  - "probability"
  - "chance"
  - "likelihood"
  - "random"
  - "Bayes"
capabilities:
  - probability-calculation
  - bayesian-reasoning
  - risk-modeling
version: "1.0.0"
---
# Probability

## Fundamentals
- **P(A):** probability of event A, range [0, 1]
- **P(A and B):** joint probability — P(A) * P(B) if independent
- **P(A or B):** P(A) + P(B) - P(A and B)
- **P(A|B):** conditional probability — P(A and B) / P(B)
- **Complement:** P(not A) = 1 - P(A)

## Bayes' Theorem
```
P(A|B) = P(B|A) * P(A) / P(B)
```
- **Prior:** P(A) — initial belief before evidence
- **Likelihood:** P(B|A) — probability of evidence given hypothesis
- **Posterior:** P(A|B) — updated belief after evidence
- **Evidence:** P(B) — total probability of the evidence

### Example: Spam Filter
- P(spam) = 0.3 (30% of emails are spam)
- P("free"|spam) = 0.8 (80% of spam contains "free")
- P("free"|not spam) = 0.1
- P("free") = 0.8 * 0.3 + 0.1 * 0.7 = 0.31
- P(spam|"free") = 0.8 * 0.3 / 0.31 = 0.774

## Common Distributions
- **Bernoulli:** single yes/no trial (coin flip)
- **Binomial:** number of successes in N trials
- **Poisson:** count of events in fixed time/space
- **Normal:** continuous, bell-shaped, characterized by mean and std dev
- **Exponential:** time between events in a Poisson process

## Practical Applications
- **A/B testing:** is the difference statistically significant?
- **Risk assessment:** probability of failure * impact = risk score
- **Reliability:** mean time between failures (MTBF)
- **Queuing theory:** server capacity planning
- **Monte Carlo simulation:** estimate outcomes via random sampling

## Law of Large Numbers
- As sample size increases, sample mean approaches population mean
- Practical: more data = more reliable estimates
- Caveat: doesn't guarantee short-term convergence

## Common Mistakes
- **Gambler's fallacy:** past events don't affect independent future events
- **Base rate neglect:** ignoring prior probabilities
- **Confusion of inverse:** P(A|B) is not P(B|A)
- **Birthday paradox:** 23 people → 50% chance of shared birthday
