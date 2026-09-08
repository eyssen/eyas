---
name: oci-oracle
description: Oracle Cloud Infrastructure (OCI) services and Kubernetes (OKE)
trigger_patterns:
  - "oci"
  - "oracle cloud"
  - "oke"
  - "oracle kubernetes"
  - "oci compute"
capabilities:
  - devops
version: "1.0.0"
---
# Oracle Cloud Infrastructure (OCI)

## Core Services
- **Compute**: VM instances, bare metal, ARM-based Ampere A1 (free tier)
- **OKE**: Oracle Kubernetes Engine — managed Kubernetes
- **Block Volume**: persistent block storage for VMs and K8s
- **Object Storage**: S3-compatible, tiered (Standard, Infrequent, Archive)
- **VCN**: Virtual Cloud Network — subnets, security lists, route tables
- **Load Balancer**: flexible shape (10-8000 Mbps)

## OKE Specifics
```yaml
# OCI Load Balancer annotation
metadata:
  annotations:
    service.beta.kubernetes.io/oci-load-balancer-shape: "flexible"
    service.beta.kubernetes.io/oci-load-balancer-shape-flex-min: "10"
    service.beta.kubernetes.io/oci-load-balancer-shape-flex-max: "100"

# OCI Block Volume StorageClass
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: oci-bv
provisioner: blockvolume.csi.oraclecloud.com
parameters:
  vpusPerGB: "20"
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
```

## OCI CLI Essentials
- `oci compute instance list --compartment-id <ocid>`
- `oci ce cluster list --compartment-id <ocid>`
- `oci os object put -bn <bucket> --file <path>`
- `oci iam compartment list`

## Free Tier Resources
- 2x AMD Compute VMs (1/8 OCPU, 1 GB RAM each)
- Up to 4x Ampere A1 instances (24 GB RAM, 4 OCPUs total)
- 200 GB Block Volume, 10 GB Object Storage
- 1 Always Free OKE cluster (control plane only)

## Networking
- VCN with public and private subnets
- NAT Gateway for outbound internet from private subnets
- Service Gateway for access to OCI services without internet
- Network Security Groups (NSG) for fine-grained firewall rules

## Best Practices
- Use compartments for resource organization and billing
- Tag all resources for cost tracking
- Use private subnets for workloads, public for load balancers only
- Enable OCI Vault for secrets management
- Use instance principals for K8s-to-OCI API authentication
