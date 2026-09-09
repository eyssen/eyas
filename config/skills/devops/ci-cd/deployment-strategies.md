---
name: deployment-strategies
description: Deployment strategies — rolling, blue-green, canary, and feature flags
trigger_patterns:
  - "deployment strategy"
  - "blue green"
  - "canary deployment"
  - "rolling update"
  - "zero downtime"
capabilities:
  - devops
version: "1.0.0"
---
# Deployment Strategies

## Rolling Update (Kubernetes Default)
- Gradually replaces old pods with new ones
- Configurable via `maxUnavailable` and `maxSurge`
- Zero downtime if readiness probes are configured
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

## Blue-Green Deployment
- Two identical environments: blue (current) and green (new)
- Deploy to green, test, then switch traffic via service selector
- Instant rollback: switch service back to blue
- Requires 2x resources during deployment

```yaml
# Switch traffic by updating the service selector
spec:
  selector:
    app: eyas
    version: green  # change to 'blue' for rollback
```

## Canary Deployment
- Route a small percentage of traffic to the new version
- Monitor error rates and performance metrics
- Gradually increase traffic if metrics are healthy
- Use Istio, Nginx Ingress, or Argo Rollouts for traffic splitting

## Feature Flags
- Deploy code with features behind flags
- Enable features per-user, per-group, or percentage-based
- Decouple deployment from feature release
- Clean up old flags regularly to avoid technical debt

## Choosing a Strategy
| Strategy | Complexity | Rollback Speed | Resource Cost |
|----------|-----------|----------------|---------------|
| Rolling | Low | Medium | Low |
| Blue-Green | Medium | Instant | High (2x) |
| Canary | High | Fast | Medium |
| Feature Flag | Medium | Instant | Low |

## Pre-Deployment Checklist
- Database migrations are backward-compatible
- Health checks and readiness probes are configured
- Monitoring and alerts are in place
- Rollback procedure is documented and tested
- Communication plan for stakeholders

## Best Practices
- Always make deployments backward-compatible (N-1 compatibility)
- Run database migrations separately from application deployment
- Monitor key metrics for at least 15 minutes after deployment
- Automate rollback based on error rate thresholds
