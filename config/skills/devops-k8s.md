---
name: kubernetes-debug
description: Debug Kubernetes pods, deployments, and services
trigger_patterns: ["k8s debug", "pod not starting", "kubectl", "kubernetes"]
capabilities: [kubectl-access, log-analysis]
version: "1.0.0"
---
# Kubernetes Debugging Guide

## Common Issues
- Pod CrashLoopBackOff: Check logs with `kubectl logs <pod> --previous`
- ImagePullBackOff: Verify image name and registry credentials
- Pending pods: Check node resources and PVC binding

## Useful Commands
- `kubectl describe pod <name>` — detailed pod status
- `kubectl get events --sort-by=.lastTimestamp` — recent cluster events
- `kubectl top pods` — resource usage
