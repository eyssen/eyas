---
name: readme-templates
description: Creating effective README files for projects, libraries, and tools
trigger_patterns:
  - "README"
  - "project readme"
  - "write a readme"
  - "readme template"
capabilities:
  - readme-creation
  - project-description
  - onboarding
version: "1.0.0"
---
# README Templates

## Essential Sections

### 1. Project Title and Description
- Clear, concise title
- One-paragraph description of what it does and why
- Badges: build status, version, license, coverage

### 2. Quick Start
```bash
# Installation
npm install my-package

# Basic usage
import { MyLib } from 'my-package';
const result = MyLib.doSomething();
```

### 3. Features
- Bullet list of key features
- Keep to 5-8 items
- Each item is a clear benefit, not a technical spec

### 4. Installation
- Prerequisites (runtime, OS, dependencies)
- Step-by-step installation commands
- Verify installation command

### 5. Usage
- Most common use case with code example
- Configuration options table
- Link to full API documentation

### 6. Contributing
- How to set up development environment
- How to run tests
- Pull request process
- Code of conduct reference

### 7. License
- License name with link to LICENSE file

## README by Project Type

### Library/Package
Focus on: installation, API usage, examples, TypeScript types

### Application
Focus on: deployment, configuration, environment variables, architecture overview

### CLI Tool
Focus on: installation, command reference, examples, configuration file format

### Internal/Team Project
Focus on: architecture, development setup, deployment, runbooks

## Best Practices
- Keep the README concise — link to detailed docs for depth
- Include a table of contents for longer READMEs
- Test all code examples regularly
- Use relative links for in-repo references
- Include screenshots/GIFs for visual projects
- Update README when features change

## What NOT to Include
- Implementation details that change frequently
- Auto-generated API docs (link to them instead)
- Meeting notes or project management artifacts
- Credentials or environment-specific configuration
