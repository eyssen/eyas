---
name: k8s-debugging
description: Kubernetes debugging techniques and troubleshooting
trigger_patterns:
  - "k8s debug"
  - "pod not starting"
  - "kubernetes troubleshoot"
  - "crashloopbackoff"
  - "pod stuck"
capabilities:
  - devops
version: "1.0.0"
---
# Kubernetes Debugging

## Diagnostic Flow
1. `kubectl get pods` — check pod status (Pending, CrashLoopBackOff, Error, etc.)
2. `kubectl describe pod <name>` — read Events section for scheduling/pull errors
3. `kubectl logs <pod>` — check application logs
4. `kubectl logs <pod> --previous` — logs from the crashed container

## Common Issues

### CrashLoopBackOff
- Application crashes on startup — check logs for the error
- Missing environment variables or config files
- Permission denied (wrong user, read-only filesystem)
- OOM killed — increase memory limits

### ImagePullBackOff
- Wrong image name or tag
- Private registry without imagePullSecrets
- Registry rate limiting (Docker Hub)

### Pending
- Insufficient resources — check `kubectl describe node`
- PVC not bound — check storage class and PV availability
- Node selector/affinity not matching any node
- Taints without matching tolerations

### Evicted
- Node under disk or memory pressure
- Set appropriate resource requests to avoid eviction

## Debugging Tools
```bash
# Ephemeral debug container
kubectl debug -it <pod> --image=busybox --target=<container>

# Port forward to access service locally
kubectl port-forward svc/<service> 8080:80

# Check resource usage
kubectl top pods
kubectl top nodes

# View events cluster-wide
kubectl get events --sort-by='.lastTimestamp'
```

## Network Debugging
- `kubectl exec <pod> -- nslookup <service>` — DNS resolution
- `kubectl exec <pod> -- wget -qO- http://<service>:<port>/health` — connectivity
- Check NetworkPolicy if connections are refused

## Best Practices
- Always set resource requests and limits
- Use readiness probes to prevent traffic to unready pods
- Structure logs as JSON for easier searching
- Label pods consistently for filtering and debugging
