import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Minimal config: no R2 incremental cache override, so the deploy needs no
// extra Cloudflare resources beyond the Worker itself. Add an incremental
// cache later if ISR page caching becomes worth the extra bucket.
export default defineCloudflareConfig()
