---
name: linear-algebra
description: Linear algebra operations for vectors, matrices, and transformations
trigger_patterns:
  - "matrix"
  - "vector"
  - "linear algebra"
  - "dot product"
  - "eigenvalue"
capabilities:
  - matrix-operations
  - vector-math
  - transformations
version: "1.0.0"
sources:
  - name: mathjs
    url: https://github.com/josdejong/mathjs
    license: Apache-2.0
---
# Linear Algebra

## Vector Operations
```typescript
import { multiply, add, dot, cross, norm } from 'mathjs';

const a = [1, 2, 3];
const b = [4, 5, 6];

add(a, b);        // [5, 7, 9]
dot(a, b);        // 32 (1*4 + 2*5 + 3*6)
cross(a, b);      // [-3, 6, -3]
norm(a);           // 3.7416... (magnitude)
```

## Matrix Operations
```typescript
import { matrix, multiply, transpose, inv, det } from 'mathjs';

const A = matrix([[1, 2], [3, 4]]);
const B = matrix([[5, 6], [7, 8]]);

multiply(A, B);    // [[19, 22], [43, 50]]
transpose(A);      // [[1, 3], [2, 4]]
inv(A);            // [[-2, 1], [1.5, -0.5]]
det(A);            // -2
```

## Key Concepts

### Dot Product
- Scalar result: a . b = |a| * |b| * cos(theta)
- Used for: similarity (cosine similarity), projections
- If dot product = 0, vectors are perpendicular

### Matrix Multiplication
- (m x n) * (n x p) = (m x p)
- Not commutative: A*B != B*A (generally)
- Used for: transformations, neural networks, solving systems

### Determinant
- Scalar value from square matrix
- det = 0 means matrix is singular (not invertible)
- Sign indicates orientation change

### Eigenvalues and Eigenvectors
- Av = lambda * v (A is matrix, v is eigenvector, lambda is eigenvalue)
- Used for: PCA, stability analysis, graph algorithms
- `mathjs.eigs(A)` computes eigenvalues and eigenvectors

## Applications in Software
- **Embeddings:** cosine similarity for text/image similarity
- **Transformations:** 2D/3D graphics (rotation, scaling, translation)
- **Machine learning:** feature transformation, PCA, SVD
- **Graph algorithms:** adjacency matrix, PageRank
- **Solving systems:** Ax = b → x = A^(-1) * b

## Cosine Similarity (Common in AI)
```typescript
function cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dotProduct / (normA * normB);
}
```
