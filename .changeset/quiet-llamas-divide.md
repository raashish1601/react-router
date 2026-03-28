---
"@react-router/dev": patch
---

Fix RSC `optimizeDeps` scanning so client prebundling strips server-only route
exports before Rolldown crawls route-module dependencies.
