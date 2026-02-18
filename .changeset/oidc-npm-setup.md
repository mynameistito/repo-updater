---
"repo-updater": patch
---

Add Node.js setup with OIDC registry configuration for npm publishing.

- Setup Node.js with registry-url for npmjs.org
- Enable OIDC-based authentication without requiring NPM_TOKEN secret
- Simplify npm credentials handling in GitHub Actions workflow
