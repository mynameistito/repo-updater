---
"repo-updater": patch
---

Fix GitHub Actions release workflow to use GitHub OIDC for NPM publishing.

- Configure npm registry with OIDC trusted publishing
- Remove NPM_TOKEN secret dependency
- Enable both GitHub and NPM package publishing in single workflow
