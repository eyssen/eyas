---
name: rust
description: Rust ownership, borrowing, error handling, and concurrency patterns
trigger_patterns:
  - "rust"
  - "ownership"
  - "borrowing"
  - "rust error handling"
  - "lifetime"
capabilities:
  - coding
version: "1.0.0"
sources:
  - name: Rust
    url: https://github.com/rust-lang/rust
    license: MIT
---
# Rust Best Practices

## Ownership Rules
1. Each value has exactly one owner
2. When the owner goes out of scope, the value is dropped
3. Ownership can be transferred (moved) or borrowed

## Borrowing
```rust
fn process(data: &[u8]) -> usize { data.len() }       // immutable borrow
fn modify(data: &mut Vec<u8>) { data.push(0xFF); }     // mutable borrow
```
Rule: one `&mut` OR many `&` — never both simultaneously.

## Error Handling with Result
```rust
use thiserror::Error;

#[derive(Error, Debug)]
enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("io error")]
    Io(#[from] std::io::Error),
}

fn load_config(path: &str) -> Result<Config, AppError> {
    let data = std::fs::read_to_string(path)?;  // ? propagates error
    Ok(parse(data)?)
}
```

## Option Combinators
```rust
let name = user.name.as_deref().unwrap_or("anonymous");
let value = map.get("key").cloned().unwrap_or_default();
```

## Concurrency with Channels
```rust
use std::sync::mpsc;
let (tx, rx) = mpsc::channel();
std::thread::spawn(move || { tx.send(42).unwrap(); });
println!("received: {}", rx.recv().unwrap());
```

## Trait-Based Polymorphism
```rust
trait Handler: Send + Sync {
    fn handle(&self, req: Request) -> Response;
}
```
