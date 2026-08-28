---
name: alerting
description: Alerting strategies, thresholds, and incident response patterns
trigger_patterns:
  - "alerting"
  - "alerts"
  - "on-call"
  - "incident"
  - "alert rules"
capabilities:
  - devops
version: "1.0.0"
---
# Alerting

## Alert Design Principles
- Alert on symptoms (high error rate), not causes (CPU spike)
- Every alert should be actionable — if no action is needed, it is noise
- Include runbook links in alert annotations
- Use severity levels: critical (page), warning (ticket), info (dashboard)

## Prometheus Alert Rules
```yaml
groups:
  - name: eyas
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          / sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error rate above 5% for 5 minutes"
          runbook: "https://wiki.example.com/runbooks/high-error-rate"

      - alert: HighLatency
        expr: |
          histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "p95 latency above 2 seconds"
```

## SLO-Based Alerting
- Define Service Level Objectives (e.g., 99.9% availability, p99 < 500ms)
- Calculate error budgets — alert when burn rate is too high
- Multi-window alerts: fast burn (short window) for urgent, slow burn for tickets

## Alert Fatigue Prevention
- Group related alerts — do not send 100 individual pod alerts
- Use inhibition rules — critical silences warning for the same issue
- Review and prune alerts quarterly
- Track alert-to-action ratio — aim for > 80% actionable

## Notification Channels
- Critical: PagerDuty/Opsgenie (phone call, SMS)
- Warning: Slack/Teams channel notification
- Info: dashboard only, no notification

## Incident Response
1. **Acknowledge** — stop the alert from escalating
2. **Assess** — determine impact and severity
3. **Mitigate** — restore service (rollback, scale, redirect)
4. **Root cause** — investigate after service is stable
5. **Post-mortem** — document timeline, impact, and action items

## Best Practices
- Test alerts in staging before deploying to production
- Use `for` duration to avoid flapping (minimum 5 minutes for most alerts)
- Document escalation paths and responsibilities
- Rotate on-call schedules to prevent burnout
