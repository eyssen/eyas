---
name: python
description: Python 3.12+ type hints, async patterns, and modern idioms
trigger_patterns:
  - "python"
  - "type hints"
  - "asyncio"
  - "python async"
  - "pydantic"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Python
    url: https://github.com/python/cpython
    license: PSF-2.0
---
# Python 3.12+ Best Practices

## Type Hints (PEP 695 — 3.12+)
```python
type Point = tuple[float, float]
type Matrix[T] = list[list[T]]

def find_item[T](items: list[T], predicate: Callable[[T], bool]) -> T | None:
    return next((x for x in items if predicate(x)), None)
```

## Modern Union Syntax
```python
def process(value: int | str | None) -> dict[str, Any]:
    ...
```

## Async Patterns
```python
import asyncio

async def fetch_all(urls: list[str]) -> list[Response]:
    async with aiohttp.ClientSession() as session:
        tasks = [session.get(url) for url in urls]
        return await asyncio.gather(*tasks)
```

## Structural Pattern Matching (3.10+)
```python
match command:
    case {"action": "move", "direction": str() as d}:
        move(d)
    case {"action": "quit"}:
        sys.exit(0)
```

## Dataclasses with Slots
```python
from dataclasses import dataclass

@dataclass(slots=True, frozen=True)
class Config:
    host: str
    port: int = 8080
```

## Context Managers
```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def managed_connection(url: str):
    conn = await connect(url)
    try:
        yield conn
    finally:
        await conn.close()
```
