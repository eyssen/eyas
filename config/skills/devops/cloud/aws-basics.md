---
name: aws-basics
description: AWS core services and SDK v3 usage
trigger_patterns:
  - "aws"
  - "amazon web services"
  - "s3"
  - "aws sdk"
  - "lambda"
capabilities:
  - devops
version: "1.0.0"
sources:
  - name: "@aws-sdk"
    url: https://github.com/aws/aws-sdk-js-v3
    license: Apache-2.0
---
# AWS Basics

## SDK v3 (Modular)
```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'eu-central-1' });

// Upload
await s3.send(new PutObjectCommand({
  Bucket: 'my-bucket',
  Key: 'data/file.json',
  Body: JSON.stringify(data),
  ContentType: 'application/json',
}));

// Download
const response = await s3.send(new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'data/file.json',
}));
const body = await response.Body?.transformToString();
```

## Core Services
- **S3**: object storage — static files, backups, data lake
- **EC2**: virtual machines with auto-scaling groups
- **EKS**: managed Kubernetes
- **RDS**: managed databases (PostgreSQL, MySQL, Aurora)
- **Lambda**: serverless functions (event-driven)
- **SQS/SNS**: message queues and pub/sub
- **CloudFront**: CDN for static and dynamic content
- **IAM**: identity and access management

## SDK v3 Best Practices
- Import only the clients you need (tree-shakeable)
- Use middleware stack for cross-cutting concerns (logging, retry)
- Configure retries: `maxAttempts: 3` (default)
- Use credential providers (environment, SSO, instance profile)

## S3 Patterns
- Pre-signed URLs for temporary direct access
- Multipart upload for files > 100 MB
- Lifecycle rules for automatic archival or deletion
- Server-side encryption (SSE-S3 or SSE-KMS)

## Security
- Follow least-privilege IAM policies
- Use IAM roles (not access keys) for services
- Enable CloudTrail for API audit logging
- Use VPC endpoints for private S3/DynamoDB access
- Rotate credentials regularly if using access keys

## Cost Optimization
- Use reserved instances or savings plans for steady workloads
- Enable S3 Intelligent-Tiering for unknown access patterns
- Set billing alerts in CloudWatch
- Tag resources for cost allocation
