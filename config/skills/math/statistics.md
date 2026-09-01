---
name: statistics
description: Statistical analysis techniques including descriptive stats, distributions, and hypothesis testing
trigger_patterns:
  - "statistics"
  - "mean median"
  - "standard deviation"
  - "correlation"
  - "hypothesis test"
capabilities:
  - descriptive-stats
  - hypothesis-testing
  - correlation-analysis
version: "1.0.0"
sources:
  - name: simple-statistics
    url: https://github.com/simple-statistics/simple-statistics
    license: ISC
---
# Statistics

## Descriptive Statistics
- **Mean (average):** sum of values / count
- **Median:** middle value when sorted (robust to outliers)
- **Mode:** most frequent value
- **Standard Deviation:** measure of spread around the mean
- **Variance:** standard deviation squared
- **Percentiles:** P25 (Q1), P50 (median), P75 (Q3)
- **IQR (Interquartile Range):** Q3 - Q1 (outlier detection: < Q1-1.5*IQR or > Q3+1.5*IQR)

## Using simple-statistics
```typescript
import { mean, median, standardDeviation, linearRegression } from 'simple-statistics';

const data = [10, 20, 30, 40, 50];
mean(data);               // 30
median(data);              // 30
standardDeviation(data);   // 14.14...

// Linear regression
const pairs = [[1, 2], [2, 4], [3, 6]];
linearRegression(pairs);   // { m: 2, b: 0 }
```

## Distributions
- **Normal:** bell curve, defined by mean and std dev
- **Uniform:** equal probability across range
- **Poisson:** count of events in fixed interval
- **Binomial:** success/failure over N trials

## Hypothesis Testing
1. State null hypothesis (H0) and alternative (H1)
2. Choose significance level (alpha, typically 0.05)
3. Calculate test statistic
4. Compare p-value to alpha
5. Reject H0 if p-value < alpha

Common tests:
- **t-test:** compare means of two groups
- **chi-squared:** test independence of categorical variables
- **ANOVA:** compare means of 3+ groups
- **Pearson correlation:** linear relationship strength (-1 to 1)

## Practical Applications
- A/B testing: compare conversion rates between variants
- Performance monitoring: detect anomalies via z-scores
- Forecasting: trend analysis with regression
- Quality control: process capability analysis

## Common Pitfalls
- Correlation does not imply causation
- Small sample sizes lead to unreliable conclusions
- Cherry-picking data to support a conclusion
- Ignoring confounding variables
- Assuming normal distribution without checking
