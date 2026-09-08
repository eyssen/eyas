---
name: regex-patterns
description: Common regular expression patterns for validation, parsing, and text extraction
trigger_patterns:
  - "regex"
  - "regular expression"
  - "pattern matching"
  - "validate email"
  - "parse string"
capabilities:
  - pattern-creation
  - validation
  - text-extraction
version: "1.0.0"
---
# Regular Expression Patterns

## Common Patterns

### Email
```regex
^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
```

### URL
```regex
^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$
```

### Phone (International)
```regex
^\+?[1-9]\d{1,14}$
```

### Hungarian Phone
```regex
^(\+36|06)(20|30|31|50|70)\d{7}$
```

### IPv4
```regex
^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$
```

### UUID v4
```regex
^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
```

### Date (ISO 8601)
```regex
^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$
```

### Semantic Version
```regex
^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$
```

## JavaScript/TypeScript Usage
```typescript
// Test
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
emailRegex.test('user@example.com');  // true

// Match with groups
const dateRegex = /(\d{4})-(\d{2})-(\d{2})/;
const match = '2026-04-12'.match(dateRegex);
// match[1] = "2026", match[2] = "04", match[3] = "12"

// Named groups
const namedRegex = /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/;
const { groups } = '2026-04-12'.match(namedRegex)!;
// groups.year = "2026", groups.month = "04"

// Replace
'hello world'.replace(/world/, 'regex');  // "hello regex"

// Global replace
'aaa'.replace(/a/g, 'b');  // "bbb"

// matchAll (iterate all matches)
const matches = [...'cat bat hat'.matchAll(/[cbh]at/g)];
```

## Regex Syntax Quick Reference
| Pattern | Meaning |
|---------|---------|
| `.` | Any character (except newline) |
| `\d` | Digit [0-9] |
| `\w` | Word char [a-zA-Z0-9_] |
| `\s` | Whitespace |
| `*` | 0 or more |
| `+` | 1 or more |
| `?` | 0 or 1 |
| `{n,m}` | Between n and m |
| `^` / `$` | Start / end of string |
| `(...)` | Capture group |
| `(?:...)` | Non-capture group |
| `(?=...)` | Lookahead |
| `(?<=...)` | Lookbehind |

## Tips
- Use raw strings or double-escape backslashes in code
- Test with tools like regex101.com
- Prefer specific patterns over greedy `.*`
- Use named groups for readability
- Consider performance: avoid catastrophic backtracking
