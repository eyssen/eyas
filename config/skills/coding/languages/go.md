---
name: go
description: Go goroutines, channels, error handling, and idiomatic patterns
trigger_patterns:
  - "golang"
  - "go language"
  - "goroutine"
  - "channels"
  - "go error handling"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Go
    url: https://github.com/golang/go
    license: BSD-3-Clause
---
# Go Best Practices

## Error Handling
Always check errors immediately — never discard them:
```go
data, err := os.ReadFile("config.yaml")
if err != nil {
    return fmt.Errorf("reading config: %w", err)  // wrap with context
}
```

## Custom Error Types
```go
type NotFoundError struct {
    Resource string
    ID       string
}
func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %s not found", e.Resource, e.ID)
}
```

## Goroutines and Channels
```go
ch := make(chan Result, 10)  // buffered channel
go func() {
    defer close(ch)
    for _, item := range items {
        ch <- process(item)
    }
}()
for result := range ch {
    handle(result)
}
```

## Context for Cancellation
```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
result, err := fetchWithContext(ctx, url)
```

## Interface Design
Keep interfaces small — accept interfaces, return structs:
```go
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

## Struct Embedding
```go
type Server struct {
    http.Server
    logger *slog.Logger
}
```
