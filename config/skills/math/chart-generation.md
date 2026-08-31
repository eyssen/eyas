---
name: chart-generation
description: Generating charts and graphs using Chart.js
trigger_patterns:
  - "create chart"
  - "generate chart"
  - "chart.js"
  - "bar chart"
  - "line chart"
  - "pie chart"
capabilities:
  - chart-creation
  - chart-configuration
  - data-formatting
version: "1.0.0"
sources:
  - name: Chart.js
    url: https://github.com/chartjs/Chart.js
    license: MIT
---
# Chart Generation with Chart.js

## Basic Setup
```typescript
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);
```

## Line Chart
```typescript
new Chart(ctx, {
  type: 'line',
  data: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    datasets: [{
      label: 'Revenue',
      data: [1200, 1900, 3000, 5000, 4000],
      borderColor: '#3b82f6',
      tension: 0.3,
      fill: false,
    }],
  },
  options: {
    responsive: true,
    plugins: {
      title: { display: true, text: 'Monthly Revenue' },
    },
    scales: {
      y: { beginAtZero: true, title: { display: true, text: 'USD' } },
    },
  },
});
```

## Bar Chart
```typescript
new Chart(ctx, {
  type: 'bar',
  data: {
    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
    datasets: [
      { label: '2025', data: [300, 450, 600, 500], backgroundColor: '#3b82f6' },
      { label: '2026', data: [400, 500, 700, 650], backgroundColor: '#10b981' },
    ],
  },
  options: {
    responsive: true,
    plugins: { legend: { position: 'top' } },
  },
});
```

## Doughnut / Pie Chart
```typescript
new Chart(ctx, {
  type: 'doughnut',
  data: {
    labels: ['Frontend', 'Backend', 'DevOps', 'Design'],
    datasets: [{
      data: [40, 30, 20, 10],
      backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
    }],
  },
});
```

## Chart Types Available
- `line` — trends over time
- `bar` — category comparison
- `pie` / `doughnut` — proportions
- `radar` — multi-dimensional comparison
- `scatter` — x/y relationships
- `bubble` — x/y/size relationships
- `polarArea` — radial proportions

## Configuration Options
- `responsive: true` — auto-resize to container
- `maintainAspectRatio: false` — allow custom dimensions
- `plugins.legend.position` — 'top', 'bottom', 'left', 'right'
- `plugins.tooltip` — customize hover tooltips
- `scales.x/y.title` — axis labels
- `animation.duration` — animation speed (ms)

## Tips
- Always set `responsive: true` for dynamic layouts
- Use `beginAtZero: true` on value axes for honest representation
- Limit datasets to 5-7 for readability
- Use consistent colors across related charts
- Destroy charts before recreating: `chart.destroy()`
