---
name: algorithms
description: Common algorithms and data structures for software development
trigger_patterns:
  - "algorithm"
  - "sorting"
  - "searching"
  - "data structure"
  - "big O"
  - "complexity"
capabilities:
  - algorithm-selection
  - complexity-analysis
  - implementation-guidance
version: "1.0.0"
---
# Algorithms & Data Structures

## Time Complexity (Big O)
| Notation | Name | Example |
|----------|------|---------|
| O(1) | Constant | Hash table lookup |
| O(log n) | Logarithmic | Binary search |
| O(n) | Linear | Array scan |
| O(n log n) | Linearithmic | Merge sort, quick sort (avg) |
| O(n^2) | Quadratic | Bubble sort, nested loops |
| O(2^n) | Exponential | Recursive fibonacci (naive) |

## Sorting
- **Array.sort():** TimSort, O(n log n), stable — use for most cases
- **Quick Sort:** O(n log n) average, O(n^2) worst — fast in practice
- **Merge Sort:** O(n log n) guaranteed, stable — good for linked lists
- **Counting Sort:** O(n+k) — when range is known and small

## Searching
- **Linear Search:** O(n) — unsorted data
- **Binary Search:** O(log n) — sorted data
```typescript
function binarySearch(arr: number[], target: number): number {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
```

## Data Structures
- **Array:** O(1) access, O(n) insert/delete — most common
- **Map/Object:** O(1) average lookup — key-value storage
- **Set:** O(1) membership check — unique values
- **Stack (LIFO):** push/pop O(1) — undo, DFS, expression parsing
- **Queue (FIFO):** enqueue/dequeue O(1) — BFS, task scheduling
- **Priority Queue/Heap:** O(log n) insert/extract — scheduling, Dijkstra
- **Linked List:** O(1) insert at head — rare in JS/TS (use arrays)
- **Tree:** O(log n) operations — hierarchical data, DOM
- **Graph:** adjacency list/matrix — relationships, networks

## Graph Algorithms
- **BFS:** shortest path in unweighted graph, level-order traversal
- **DFS:** topological sort, cycle detection, connected components
- **Dijkstra:** shortest path with weighted edges (non-negative)
- **A*:** shortest path with heuristic (pathfinding)

## Dynamic Programming
When a problem has:
1. Overlapping subproblems
2. Optimal substructure

Approach: memoization (top-down) or tabulation (bottom-up)
```typescript
// Fibonacci with memoization
function fib(n: number, memo = new Map<number, number>()): number {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n)!;
  const result = fib(n - 1, memo) + fib(n - 2, memo);
  memo.set(n, result);
  return result;
}
```

## Choosing the Right Structure
| Need | Use |
|------|-----|
| Fast lookup by key | Map |
| Unique values | Set |
| Ordered data | Array (sorted) |
| FIFO processing | Queue |
| Undo/redo | Stack |
| Priority scheduling | Heap |
| Hierarchical data | Tree |
