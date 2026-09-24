---
name: container-security
description: Container security hardening and best practices
trigger_patterns:
  - "container security"
  - "docker security"
  - "image scanning"
  - "container hardening"
capabilities:
  - devops
  - security
version: "1.0.0"
---
# Container Security

## Image Security
- Use official or verified base images from trusted registries
- Pin image digests for reproducible builds: `FROM node:22@sha256:abc...`
- Scan images for CVEs with Trivy, Grype, or Snyk
- Rebuild images regularly to pick up base image security patches
- Remove unnecessary packages and tools from production images

## Runtime Security
```dockerfile
# Non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app

# Read-only filesystem
# Set in Kubernetes securityContext or docker run --read-only
```

## Kubernetes Security Context
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
```

## Secrets Management
- Never bake secrets into images (ENV, COPY, ARG are all visible in layers)
- Use Docker BuildKit secrets for build-time secrets
- Inject runtime secrets via environment variables or mounted files
- Use Kubernetes Secrets or external secret operators

## Network Security
- Limit container-to-container communication with network policies
- Do not expose unnecessary ports
- Use TLS for all service-to-service communication
- Drop all capabilities and add back only what is needed

## Supply Chain Security
- Sign images with cosign (Sigstore)
- Use SBOM generation (syft) for dependency tracking
- Enforce image policies in Kubernetes (Kyverno, OPA Gatekeeper)
- Verify base image provenance

## Scanning and Monitoring
- Integrate image scanning into CI/CD pipeline
- Monitor running containers for anomalous behavior
- Set up alerts for container escape attempts
- Audit container logs for security events
