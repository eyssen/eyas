---
name: rate-limiting-ddos
description: DDoS mitigation, rate limiting layers, and abuse prevention
trigger_patterns:
  - "ddos"
  - "denial of service"
  - "abuse prevention"
  - "rate limit security"
  - "flood protection"
capabilities:
  - security
version: "1.0.0"
---
# Rate Limiting and DDoS Mitigation

## Defense Layers
1. **CDN / Edge** (Cloudflare, Fastly) — absorb volumetric attacks
2. **Load balancer** — connection limits, SYN flood protection
3. **Application** — per-user/IP rate limiting, request validation
4. **Database** — connection pooling, query timeouts

## Application-Level Rate Limiting
```typescript
const rateLimits: Record<string, { rpm: number; burst: number }> = {
  'POST /api/v1/auth/login': { rpm: 10, burst: 3 },
  'POST /api/v1/auth/register': { rpm: 5, burst: 2 },
  'GET /api/v1/*': { rpm: 100, burst: 20 },
  'POST /api/v1/*': { rpm: 30, burst: 10 },
};
```

## Abuse Detection Signals
- Rapid-fire requests from single IP
- Unusually large request bodies
- Requests to non-existent endpoints (scanning)
- Failed authentication spikes
- Abnormal user-agent patterns

## Mitigation Strategies
- **Exponential backoff** — increase delay with each violation
- **Temporary ban** — block IP after repeated violations (auto-expire)
- **CAPTCHA challenge** — for suspicious but not definitively malicious traffic
- **Request queuing** — absorb bursts, process at sustainable rate
- **Circuit breaker** — shed load when system is overwhelmed

## Slowloris / Low-and-Slow Attacks
- Set aggressive connection timeouts (30s)
- Limit concurrent connections per IP
- Set maximum header size and request body size
- Use reverse proxy (nginx) to buffer slow clients

## Infrastructure Hardening
- Enable SYN cookies at OS level
- Configure `keepalive_timeout` in reverse proxy
- Use anycast DNS for geographic distribution
- Implement health-check-based auto-scaling

## Monitoring
- Alert on: request rate spikes, error rate increase, latency p99 jump
- Track: requests per IP, per user, per endpoint
- Log blocked requests for forensics
