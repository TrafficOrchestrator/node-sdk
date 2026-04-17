# @traffic-orchestrator/client

Official Node.js/TypeScript SDK for [Traffic Orchestrator](https://trafficorchestrator.com) — license validation, management, and usage analytics.

📖 [API Reference](https://trafficorchestrator.com/docs#api) · [SDK Guides](https://trafficorchestrator.com/docs/sdk/node) · [OpenAPI Spec](https://api.trafficorchestrator.com/api/v1/openapi.json)

## Install

```bash
npm install @traffic-orchestrator/client
```

## Quick Start

```ts
import { TrafficOrchestrator } from '@traffic-orchestrator/client'

// Validate a license (no auth required)
const to = new TrafficOrchestrator()
const result = await to.validateLicense('LK-xxxx-xxxx-xxxx', 'example.com')

if (result.valid) {
  console.log('License is active')
  console.log(`Plan: ${result.plan}, Expires: ${result.expiresAt}`)
}
```

## Authenticated Usage

Pass your API key for license management and usage endpoints:

```ts
const to = new TrafficOrchestrator({
  apiKey: process.env.TO_API_KEY
})

// List licenses
const licenses = await to.listLicenses()

// Create a license
const license = await to.createLicense({
  appName: 'My App',
  domain: 'example.com'
})

// Get usage stats
const usage = await to.getUsage()
console.log(`${usage.validationsMonth} / ${usage.monthlyLimit} validations used`)
```

## Error Handling

All API errors throw `TrafficOrchestratorError` with `.code`, `.status`, and `.message`:

```ts
import { TrafficOrchestrator, TrafficOrchestratorError } from '@traffic-orchestrator/client'

const to = new TrafficOrchestrator()

try {
  await to.validateLicense('invalid-token')
} catch (error) {
  if (error instanceof TrafficOrchestratorError) {
    console.error(`API Error: ${error.message} (code: ${error.code}, HTTP: ${error.status})`)
    
    switch (error.code) {
      case 'LICENSE_NOT_FOUND':
        // Handle missing license
        break
      case 'DOMAIN_MISMATCH':
        // Handle wrong domain
        break
      case 'QUOTA_EXCEEDED':
        // Handle rate limit
        break
    }
  }
}
```

## Retry & Resilience

Built-in retry with exponential backoff for network errors and 5xx responses:

```ts
const to = new TrafficOrchestrator({
  timeout: 5000,    // 5 second timeout per request
  retries: 3,       // Retry up to 3 times on failure
})

// 4xx errors (client errors) are NOT retried
// 5xx errors and network failures ARE retried with backoff
// Backoff: 1s → 2s → 4s (capped at 5s)
```

## Grace Period (v2.1.0+)

Keep your application running during API outages with grace period caching. When enabled, the last successful validation result is cached in-memory and returned if the API becomes unreachable:

```ts
const to = new TrafficOrchestrator({
  gracePeriod: true,       // Enable grace period caching
  gracePeriodTtl: 86400000 // 24 hours (default)
})

const result = await to.validateLicense('LK-xxxx', 'example.com')

if (result.valid) {
  if (result.fromCache) {
    console.warn('Using cached validation (API unreachable)')
  }
  // Application continues working regardless
}

// Manually clear the cache if needed
to.clearCache()
```

**How it works:**
- Successful validations are cached per `token:domain` key
- On network/5xx failure, cached results are returned with `fromCache: true`
- 4xx errors (invalid license, domain mismatch) are never cached
- Cache is in-memory only — resets on process restart

## Offline Verification (Enterprise)

Enterprise licenses are signed JWTs that can be verified without network access:

```ts
import { readFileSync } from 'fs'

const publicKey = readFileSync('./public_key.pem', 'utf-8')
const result = await TrafficOrchestrator.verifyOffline(
  licenseToken,
  publicKey,
  'example.com' // Optional domain check
)

if (result.valid) {
  console.log(`Plan: ${result.plan}`)
  console.log(`Domains: ${result.domains?.join(', ')}`)
  console.log(`Expires: ${result.expiresAt}`)
}
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `apiUrl` | `https://api.trafficorchestrator.com/api/v1` | API base URL |
| `apiKey` | — | Bearer token for authenticated endpoints |
| `timeout` | `10000` | Request timeout in ms |
| `retries` | `2` | Retries on 5xx/network errors (exponential backoff) |
| `gracePeriod` | `false` | Enable grace period validation caching |
| `gracePeriodTtl` | `86400000` | Grace period cache TTL in ms (default: 24 hours) |

## API Reference

| Method | Auth | Description |
|--------|------|-------------|
| `validateLicense(token, domain?)` | No | Validate a license key |
| `verifyOffline(token, publicKey, domain?)` | No | Ed25519 offline verification (static) |
| `clearCache()` | No | Clear grace period validation cache |
| `listLicenses()` | Yes | List all licenses |
| `createLicense(options)` | Yes | Create a new license |
| `addDomain(licenseId, domain)` | Yes | Add domain to license |
| `removeDomain(licenseId, domain)` | Yes | Remove domain from license |
| `getDomains(licenseId)` | Yes | Get license domains |
| `updateLicenseStatus(id, status)` | Yes | Suspend/reactivate license |
| `deleteLicense(licenseId)` | Yes | Revoke a license |
| `listApiKeys()` | Yes | List API keys |
| `createApiKey(name, scopes?)` | Yes | Create API key |
| `deleteApiKey(keyId)` | Yes | Delete API key |
| `getWebhookConfig()` | Yes | Get webhook settings |
| `setWebhookConfig(url, events?)` | Yes | Configure webhooks |
| `getUsage()` | Yes | Get usage statistics |
| `getAnalytics(days?)` | Yes | Get detailed analytics |
| `getDashboard()` | Yes | Full dashboard overview |
| `healthCheck()` | No | Check API health |

## TypeScript Types

All types are exported for full IntelliSense:

```ts
import type {
  TrafficOrchestratorConfig,
  ValidationResult,
  License,
  UsageStats,
  CreateLicenseOptions,
  ApiError,
} from '@traffic-orchestrator/client'
```

## Error Codes

See [Error Codes Reference](https://trafficorchestrator.com/docs#errors) for the complete list.

## Requirements

- Node.js 18+ (uses native `fetch`)
- TypeScript 5+ (for types)

## License

MIT
