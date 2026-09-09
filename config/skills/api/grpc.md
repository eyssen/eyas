---
name: grpc
description: gRPC service design, protobuf schemas, and streaming patterns
trigger_patterns:
  - "grpc"
  - "protobuf"
  - "proto file"
  - "rpc service"
  - "streaming rpc"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: gRPC
    url: https://github.com/grpc/grpc
    license: Apache-2.0
---
# gRPC Design Guide

## Proto File Structure
```protobuf
syntax = "proto3";
package myapp.v1;

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
  rpc WatchUsers(WatchUsersRequest) returns (stream UserEvent);  // server streaming
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  google.protobuf.Timestamp created_at = 4;
}

message GetUserRequest {
  string id = 1;
}

message ListUsersRequest {
  int32 page_size = 1;
  string page_token = 2;
}
```

## Streaming Patterns
- **Unary** — single request, single response (most common)
- **Server streaming** — single request, stream of responses (notifications, feeds)
- **Client streaming** — stream of requests, single response (file upload)
- **Bidirectional** — both sides stream (chat, real-time sync)

## Error Handling
Use standard gRPC status codes:
- `OK` (0), `INVALID_ARGUMENT` (3), `NOT_FOUND` (5)
- `PERMISSION_DENIED` (7), `INTERNAL` (13), `UNAVAILABLE` (14)

Attach error details with `google.rpc.Status` for structured errors.

## Best Practices
- Version your packages: `myapp.v1`, `myapp.v2`
- Use `FieldMask` for partial updates
- Keep messages small — stream large data
- Implement deadlines on every call
- Use interceptors for auth, logging, metrics (like HTTP middleware)
- Backward compatibility: never reuse field numbers, only add fields

## When to Choose gRPC
- Internal service-to-service communication
- High-throughput, low-latency requirements
- Strong typing and code generation needed
- Streaming use cases (events, real-time data)
