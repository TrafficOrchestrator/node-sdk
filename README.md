# Traffic Orchestrator — Node.js / TypeScript SDK

[![npm](https://img.shields.io/npm/v/@traffic-orchestrator/client?color=CB3837&label=npm)](https://www.npmjs.com/package/@traffic-orchestrator/client)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)

**Enterprise-grade software licensing, edge validation, and API management.** Protect and monetize your applications with domain-bound license keys, offline verification, and real-time analytics — powered by 300+ edge locations worldwide.

---

## Quickstart (3 steps, 60 seconds)

### 1. Create your free account

> **[Sign up at trafficorchestrator.com](https://trafficorchestrator.com/register)** — no credit card required. Free tier includes 5 licenses and 10,000 validations/month.

### 2. Get your API key

> Go to **[Dashboard ? API Keys](https://trafficorchestrator.com/dashboard/keys)** and generate a Sandbox or Live key.

### 3. Install and validate

```bash
npm install @traffic-orchestrator/client
```

```typescript
import { TrafficOrchestrator } from '@traffic-orchestrator/client'

const to = new TrafficOrchestrator({ apiKey: 'sk_live_your_key_here' })
const result = await to.validateLicense('LK-xxxx-xxxx-xxxx', 'yourdomain.com')
console.log(result.valid ? 'License active' : 'License invalid')
```

**That's it.** Your application is now license-protected.

---

## Why Traffic Orchestrator?

| Feature | Description |
|---------|-------------|
| **Domain-Bound Licensing** | SHA-256 validated keys tied to specific domains — no key sharing |
| **Edge Validation** | Sub-10ms license checks from 300+ global edge locations |
| **Offline Mode** | Ed25519 signed JWT tokens for air-gapped and offline environments |
| **Grace Period** | Configurable fallback keeps your app running during API outages |
| **Real-Time Analytics** | Track activations, usage patterns, and revenue in your dashboard |
| **Multi-Language** | Official SDKs for 12 languages — same API, consistent behavior |

## Features

- **License Validation** — Validate license keys against domains with cryptographic proof
- **License Management** — Create, update, suspend, revoke, and rotate license keys
- **Offline Verification** — Verify Ed25519-signed JWT tokens without an API call
- **Webhooks** — Real-time notifications for license events (activation, expiry, revocation)
- **Analytics & SLA Monitoring** — Track validation performance and uptime metrics

## Documentation

- ?? **[Full API Reference](https://trafficorchestrator.com/docs/api)**
- ?? **[Quickstart Guides](https://trafficorchestrator.com/docs/quickstart)**
- ?? **[Integration Examples](https://trafficorchestrator.com/docs/examples)**

## Support

- ?? [Report an Issue](https://github.com/TrafficOrchestrator/node-sdk/issues)
- ?? [Email Support](mailto:support@trafficorchestrator.com)
- ?? [Knowledge Base](https://trafficorchestrator.com/docs)

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <a href="https://trafficorchestrator.com"><strong>trafficorchestrator.com</strong></a> · 
  <a href="https://trafficorchestrator.com/register">Get Started Free</a> · 
  <a href="https://trafficorchestrator.com/docs">Docs</a>
</p>