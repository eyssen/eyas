---
name: data-visualization
description: Data visualization principles and chart type selection using Vega-Lite
trigger_patterns:
  - "data visualization"
  - "chart type"
  - "visualize data"
  - "vega"
  - "graph"
capabilities:
  - chart-selection
  - visualization-design
  - vega-lite-specs
version: "1.0.0"
sources:
  - name: vega-lite
    url: https://github.com/vega/vega-lite
    license: BSD-3-Clause
---
# Data Visualization

## Chart Type Selection

### Comparison
- **Bar chart:** compare categories (< 20 items)
- **Grouped bar:** compare subcategories within categories
- **Radar/Spider:** compare multiple dimensions

### Trend Over Time
- **Line chart:** continuous trends
- **Area chart:** cumulative trends
- **Sparkline:** compact trend in context

### Distribution
- **Histogram:** frequency distribution
- **Box plot:** quartiles, median, outliers
- **Violin plot:** distribution shape

### Part-to-Whole
- **Pie chart:** simple proportions (max 5-6 slices)
- **Stacked bar:** proportions across categories
- **Treemap:** hierarchical proportions

### Relationship
- **Scatter plot:** correlation between two variables
- **Bubble chart:** three variables (x, y, size)
- **Heatmap:** matrix of values

## Vega-Lite Example
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": { "values": [
    {"month": "Jan", "sales": 100},
    {"month": "Feb", "sales": 150},
    {"month": "Mar", "sales": 200}
  ]},
  "mark": "bar",
  "encoding": {
    "x": {"field": "month", "type": "nominal"},
    "y": {"field": "sales", "type": "quantitative"},
    "color": {"field": "month", "type": "nominal"}
  }
}
```

## Design Principles
- **Title:** always include a clear, descriptive title
- **Labels:** axis labels with units
- **Colors:** use colorblind-friendly palettes (max 7-8 distinct colors)
- **Legend:** only when needed (direct labels preferred)
- **Grid:** subtle, don't overpower the data
- **Annotation:** highlight key data points with text

## Common Mistakes
- 3D charts (distort proportions)
- Truncated y-axis (misleading magnitude)
- Too many categories in one chart
- Rainbow color schemes (not colorblind-safe)
- Pie charts for more than 5 categories
- Missing axis labels or units
