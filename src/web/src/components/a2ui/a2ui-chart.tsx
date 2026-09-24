// Part of eYssen. See LICENSE file for full copyright and licensing details.

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import type { A2UIChart as A2UIChartType } from '../../../../shared/a2ui-types'

const DEFAULT_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2, 220 70% 50%))',
  'hsl(var(--chart-3, 150 60% 45%))',
  'hsl(var(--chart-4, 30 80% 55%))',
  'hsl(var(--chart-5, 280 65% 60%))',
]

interface A2UIChartProps {
  content: A2UIChartType
}

export function A2UIChart({ content }: A2UIChartProps) {
  return (
    <div className="space-y-2">
      {content.title && (
        <p className="text-sm font-medium text-foreground">{content.title}</p>
      )}
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          {content.type === 'line' ? (
            <LineChart data={content.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey={content.xKey} className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                }}
              />
              <Legend />
              {content.yKeys.map((yk, i) => (
                <Line
                  key={yk.key}
                  type="monotone"
                  dataKey={yk.key}
                  name={yk.label ?? yk.key}
                  stroke={yk.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          ) : content.type === 'bar' ? (
            <BarChart data={content.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey={content.xKey} className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                }}
              />
              <Legend />
              {content.yKeys.map((yk, i) => (
                <Bar
                  key={yk.key}
                  dataKey={yk.key}
                  name={yk.label ?? yk.key}
                  fill={yk.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          ) : (
            <PieChart>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                }}
              />
              <Legend />
              <Pie
                data={content.data}
                dataKey={content.yKeys[0]?.key ?? 'value'}
                nameKey={content.xKey}
                cx="50%"
                cy="50%"
                outerRadius={80}
                label
              >
                {content.data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={content.yKeys[0]?.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
