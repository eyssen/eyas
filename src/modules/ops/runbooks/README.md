# Ops-agent Runbooks

Each YAML file in this directory describes a single runbook: how to recognise
an incident kind, what the operator should see, and a conservative default
remediation proposal.

Runbooks are loaded at module startup and persisted to `ops_runbooks`. They
are the primary diagnosis path — the LLM fallback only runs when no runbook
matches.

## Schema

```yaml
id: <unique-slug>               # required, matches the filename
kind: <incident-kind>           # required, the kind an observer assigns
matcher:
  type: k8s-event | prometheus | log-anomaly
  fields:                       # optional, key/value equality against incident.details
    reason: BackOff
  regex: "*Back-off*"           # optional, glob-style (* and ?); NOT full regex
  regex_target: summary         # optional, field to match against (default: summary)
diagnosis_template: |           # markdown; {{variable}} interpolated from incident
  ...
suggested_action:
  action_type: kubectl | gitops-pr | helm-upgrade | manual
  command: logs                 # kubectl sub-command (kubectl only)
  args: ["..."]                 # kubectl args (kubectl only)
  pr_path: "..."                # relative path in infra repo (gitops-pr only)
  pr_patch: |                   # unified diff (gitops-pr only)
severity: info | warning | critical
requires_approval: true         # default true; false auto-approves at propose time
```

## Bundled runbooks

| id | kind | source | default action |
|----|------|--------|----------------|
| `pod-crashloop` | pod-crashloop | k8s-event | `kubectl logs --previous` |
| `pvc-full` | pvc-full | prometheus | GitOps PR raising storage |
| `oom-memory-limit` | oom-memory-limit | k8s-event | `kubectl describe pod` |
| `certificate-renewal` | certificate-expiring | prometheus | GitOps PR forcing renewal |

## Pattern language

The `matcher.regex` field is GLOB-style, not full regular expressions. Supported
wildcards:

- `*` — matches any run of characters (including empty)
- `?` — matches exactly one character

Anchoring is implicit at both ends. Wrap with `*` for substring semantics.
This is intentional: glob matching avoids entire classes of ReDoS and pattern
correctness bugs. Use multiple runbooks if you need disjunction.
