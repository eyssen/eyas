---
name: trend-analysis
description: Identifying and analyzing technology and market trends
trigger_patterns:
  - "trend"
  - "trending"
  - "what's new in"
  - "emerging technology"
  - "market direction"
capabilities:
  - trend-identification
  - market-analysis
  - forecasting
version: "1.0.0"
---
# Trend Analysis

## Data Sources for Tech Trends
- **npm trends:** download statistics over time for JS/TS packages
- **GitHub Trending:** daily/weekly trending repositories
- **Stack Overflow Survey:** annual developer survey results
- **ThoughtWorks Tech Radar:** Adopt/Trial/Assess/Hold classification
- **State of JS/CSS/HTML:** annual ecosystem surveys
- **Hacker News / Reddit:** community discussion signals
- **Google Trends:** search interest over time
- **BuiltWith / Wappalyzer:** technology usage in production

## Analysis Framework

### Hype Cycle Position
- Innovation Trigger → Peak of Inflated Expectations → Trough of Disillusionment → Slope of Enlightenment → Plateau of Productivity
- Where is the technology on this curve?

### Adoption Curve
- Innovators (2.5%) → Early Adopters (13.5%) → Early Majority (34%) → Late Majority (34%) → Laggards (16%)
- Which group is currently adopting?

### Signal vs. Noise
- **Strong signal:** growing npm downloads + GitHub stars + job postings + conference talks
- **Weak signal:** social media hype without production usage
- **Noise:** marketing-driven buzz without technical merit

## Trend Report Structure
1. **Current state:** where things stand today
2. **Direction:** growing, stable, or declining
3. **Drivers:** what is causing the trend
4. **Implications:** what this means for our work
5. **Timeline:** when to act (now, next quarter, monitor)
6. **Risks:** what could reverse the trend

## Decision Triggers
- **Adopt now:** mainstream, proven, clear benefits
- **Experiment:** growing fast, promising, worth a PoC
- **Watch:** interesting but unproven, revisit in 6 months
- **Avoid:** declining, deprecated, or problematic license

## Avoiding Trend Traps
- Don't adopt just because it's popular
- New doesn't mean better for your use case
- Consider migration cost, not just new capability
- Boring technology is often the right choice
