---
name: k8s-storage
description: Kubernetes persistent storage — PV, PVC, StorageClass, and CSI
trigger_patterns:
  - "k8s storage"
  - "persistent volume"
  - "pvc"
  - "storage class"
  - "k8s disk"
capabilities:
  - devops
version: "1.0.0"
---
# Kubernetes Storage

## Core Concepts
- **PersistentVolume (PV)**: cluster-level storage resource
- **PersistentVolumeClaim (PVC)**: namespace-scoped request for storage
- **StorageClass**: defines provisioner and parameters for dynamic PV creation
- **CSI Driver**: Container Storage Interface plugin for specific storage backends

## PersistentVolumeClaim
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: eyas-data
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: oci-bv
  resources:
    requests:
      storage: 50Gi
```

## Using PVC in a Pod
```yaml
spec:
  containers:
    - name: eyas
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: eyas-data
```

## Access Modes
- **ReadWriteOnce (RWO)**: single node read-write (block storage)
- **ReadOnlyMany (ROX)**: multiple nodes read-only
- **ReadWriteMany (RWX)**: multiple nodes read-write (NFS, CephFS)

## OCI Block Volume StorageClass
```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: oci-bv
provisioner: blockvolume.csi.oraclecloud.com
parameters:
  vpusPerGB: "20"
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

## StatefulSet Storage
- StatefulSets use `volumeClaimTemplates` for per-pod storage
- Each pod gets a unique PVC that persists across rescheduling
- PVCs are not deleted when the StatefulSet is scaled down

## Best Practices
- Use `WaitForFirstConsumer` to bind volumes in the correct zone
- Set `reclaimPolicy: Retain` for production data
- Enable volume expansion for growing datasets
- Use `emptyDir` for temporary scratch space (lost on pod restart)
- Back up PVs regularly — Kubernetes does not handle backup
- Monitor volume usage and set alerts for capacity
