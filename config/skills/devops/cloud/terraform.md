---
name: terraform
description: Infrastructure as Code with Terraform — configuration, state, and modules
trigger_patterns:
  - "terraform"
  - "infrastructure as code"
  - "iac"
  - "terraform plan"
  - "tf"
capabilities:
  - devops
version: "1.0.0"
---
# Terraform

## Basic Configuration
```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "terraform-state"
    key    = "eyas/terraform.tfstate"
    region = "eu-frankfurt-1"
  }
}

resource "oci_core_instance" "eyas" {
  compartment_id      = var.compartment_id
  availability_domain = var.ad
  shape               = "VM.Standard.A1.Flex"
  display_name        = "eyas-server"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  source_details {
    source_type = "image"
    source_id   = var.image_id
  }
}
```

## Key Commands
- `terraform init` — initialize providers and backend
- `terraform plan` — preview changes
- `terraform apply` — apply changes (always review the plan)
- `terraform destroy` — tear down all resources
- `terraform state list` — list managed resources
- `terraform import` — import existing resources into state

## State Management
- State tracks the mapping between config and real resources
- Use remote backend (S3, OCI Object Storage) for team collaboration
- Enable state locking to prevent concurrent modifications
- Never edit state files manually — use `terraform state mv/rm`

## Modules
```hcl
module "k8s_cluster" {
  source = "./modules/oke-cluster"

  compartment_id = var.compartment_id
  cluster_name   = "eyas-prod"
  node_count     = 3
  node_shape     = "VM.Standard.A1.Flex"
}
```

## Variables and Outputs
- Use `variables.tf` for input definitions with types and defaults
- Use `outputs.tf` to expose values to other modules or the CLI
- Use `terraform.tfvars` for environment-specific values (not committed)
- Use `locals` for computed values and deduplication

## Best Practices
- Run `terraform plan` in CI, `terraform apply` manually or with approval
- Use workspaces or separate state files per environment
- Pin provider versions to avoid breaking changes
- Tag all resources with environment, project, and owner
- Keep modules small and focused — one concern per module
