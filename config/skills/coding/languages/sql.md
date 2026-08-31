---
name: sql
description: SQL best practices, joins, CTEs, window functions, and query optimization
trigger_patterns:
  - "sql query"
  - "join"
  - "CTE"
  - "window function"
  - "sql optimization"
capabilities:
  - coding
version: "1.0.0"
---
# SQL Best Practices

## Common Table Expressions (CTEs)
```sql
WITH active_users AS (
  SELECT id, name, last_login
  FROM users
  WHERE status = 'active' AND last_login > NOW() - INTERVAL '30 days'
)
SELECT a.name, COUNT(o.id) AS order_count
FROM active_users a
LEFT JOIN orders o ON o.user_id = a.id
GROUP BY a.name;
```

## Window Functions
```sql
SELECT name, department, salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank,
  SUM(salary) OVER (PARTITION BY department) AS dept_total,
  LAG(salary) OVER (ORDER BY hire_date) AS prev_salary
FROM employees;
```

## Join Types
- `INNER JOIN` — rows matching in both tables
- `LEFT JOIN` — all left rows + matching right (NULL if no match)
- `CROSS JOIN` — cartesian product (rarely needed)
- Self-join — table joined to itself (hierarchies, comparisons)

## Indexing Guidelines
- Index columns used in WHERE, JOIN, ORDER BY
- Composite index: leftmost prefix rule applies
- Avoid indexing low-cardinality columns (boolean, status with few values)
- Use partial indexes for filtered queries: `CREATE INDEX idx ON orders(status) WHERE status = 'pending'`

## Anti-Patterns to Avoid
- `SELECT *` in production queries
- Correlated subqueries where a JOIN suffices
- Missing indexes on foreign keys
- N+1 queries from ORM lazy loading
- Implicit type conversions in WHERE clauses
