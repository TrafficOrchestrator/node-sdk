
import { jwtVerify, importSPKI } from 'jose'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TrafficOrchestratorConfig {
  /** API base URL (default: production) */
  apiUrl?: string
  /** Bearer token for authenticated endpoints */
  apiKey?: string
  /** Request timeout in ms (default: 10000) */
  timeout?: number
  /** Number of retries on network failure (default: 2) */
  retries?: number
  /**
   * Enable grace period caching for license validation.
   * When enabled, the last successful validation result is cached in-memory.
   * If the API becomes unreachable, the cached result is returned for up to
   * `gracePeriodTtl` milliseconds (default: 24 hours).
   * This prevents application downtime during API outages.
   */
  gracePeriod?: boolean
  /** Grace period cache TTL in ms (default: 86400000 = 24 hours) */
  gracePeriodTtl?: number
}

export interface ValidationResult {
  valid: boolean
  payload?: Record<string, unknown>
  message?: string
  /** License plan ID (professional, business, enterprise) */
  plan?: string
  /** Domains authorized on this license */
  domains?: string[]
  /** License expiration date */
  expiresAt?: string
  /** Whether this result was served from the grace period cache */
  fromCache?: boolean
}

export interface License {
  license_id: string
  license_key: string
  status: 'active' | 'suspended' | 'revoked' | 'expired'
  plan_id: string
  domains: string[]
  created_at: string
  expires_at: string
}

export interface LicenseListResponse {
  licenses: License[]
}

export interface CreateLicenseOptions {
  appName: string
  domain?: string
  planId?: string
}

export interface UsageStats {
  validationsToday: number
  validationsMonth: number
  monthlyLimit: number
  activeLicenses: number
  activeDomains: number
}

export interface ApiError {
  error: string
  code: string
  help?: string
}

export interface SLAData {
  period: { days: number; since: string }
  uptime: { percentage: number; healthChecks: number; healthyChecks: number }
  latency: { avgMs: number; minMs: number; maxMs: number }
  errorRate: { percentage: number; totalRequests: number; errorCount: number }
  sla: { target: number; current: number; compliant: boolean; status: string }
}

export interface AuditExportResult {
  exported: number
  since: string
  logs: Array<Record<string, unknown>>
}

export interface WebhookDeliveriesResult {
  deliveries: Array<{
    delivery_id: string
    event_type: string
    status: 'pending' | 'success' | 'failed'
    response_code: number | null
    attempt_count: number
    created_at: string
    completed_at: string | null
    webhook_url: string
  }>
  total: number
  filters: { status: string; limit: number }
}

export interface BatchResult {
  action: string
  processed: number
  succeeded: number
  failed: number
  results: Array<{ licenseId: string; success: boolean; error?: string }>
}

export class TrafficOrchestratorError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'TrafficOrchestratorError'
    this.code = code
    this.status = status
  }
}

// ─── Client ────────────────────────────────────────────────────────────────────

export class TrafficOrchestrator {
  private apiUrl: string
  private apiKey: string | undefined
  private timeout: number
  private retries: number
  private gracePeriod: boolean
  private gracePeriodTtl: number
  private validationCache: Map<string, { result: ValidationResult; cachedAt: number }>

  constructor(config: TrafficOrchestratorConfig = {}) {
    this.apiUrl = (config.apiUrl || 'https://api.trafficorchestrator.com/api/v1').replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.timeout = config.timeout ?? 10_000
    this.retries = config.retries ?? 2
    this.gracePeriod = config.gracePeriod ?? false
    this.gracePeriodTtl = config.gracePeriodTtl ?? 24 * 60 * 60 * 1000 // 24 hours
    this.validationCache = new Map()
  }

  // ── Core: License Validation ────────────────────────────────────────────────

  /**
   * Validate a license key against the API server.
   * This is the primary integration point for most applications.
   *
   * @example
   * ```ts
   * const to = new TrafficOrchestrator()
   * const result = await to.validateLicense('LK-xxxx-xxxx', 'example.com')
   * if (result.valid) console.log('License is active')
   * ```
   */
  async validateLicense(token: string, domain?: string): Promise<ValidationResult> {
    const cacheKey = `${token}:${domain || ''}`

    try {
      const data = await this.request<ValidationResult>('POST', '/validate', { token, domain })

      // Cache successful results when grace period is enabled
      if (this.gracePeriod && data.valid) {
        this.validationCache.set(cacheKey, { result: data, cachedAt: Date.now() })
      }

      return data
    } catch (e: unknown) {
      // On network failure, try returning cached result if within grace period
      if (this.gracePeriod && !(e instanceof TrafficOrchestratorError && e.status < 500)) {
        const cached = this.validationCache.get(cacheKey)
        if (cached && (Date.now() - cached.cachedAt) < this.gracePeriodTtl) {
          return { ...cached.result, fromCache: true }
        }
      }
      throw e
    }
  }

  /** Clear the grace period validation cache. */
  clearCache(): void {
    this.validationCache.clear()
  }

  /**
   * Validate a license offline using Ed25519 public key verification.
   * Enterprise licenses are signed JWTs that can be verified without network access.
   *
   * @param token - The JWT license token
   * @param publicKeyPem - PEM-encoded Ed25519 public key
   * @param domain - Optional domain to verify against the license
   */
  static async verifyOffline(token: string, publicKeyPem: string, domain?: string): Promise<ValidationResult> {
    try {
      const publicKey = await importSPKI(publicKeyPem, 'EdDSA')
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: 'trafficorchestrator.com',
        audience: ['license-validation', 'license-offline']
      })

      if (domain && payload.dom && Array.isArray(payload.dom)) {
        const domains = payload.dom as string[]
        if (!domains.some(d => domain.includes(d))) {
          return { valid: false, message: 'Domain mismatch' }
        }
      }

      return {
        valid: true,
        payload: payload as Record<string, unknown>,
        plan: payload.plan as string | undefined,
        domains: payload.dom as string[] | undefined,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined
      }
    } catch (e: unknown) {
      return { valid: false, message: e instanceof Error ? e.message : 'Verification failed' }
    }
  }

  // ── License Management (requires API key) ──────────────────────────────────

  /** List all licenses for the authenticated user. */
  async listLicenses(): Promise<License[]> {
    this.requireApiKey('listLicenses')
    const data = await this.request<LicenseListResponse>('GET', '/portal/licenses')
    return data.licenses || []
  }

  /** Create a new license. */
  async createLicense(options: CreateLicenseOptions): Promise<License> {
    this.requireApiKey('createLicense')
    return this.request<License>('POST', '/portal/licenses', options)
  }

  // ── Usage & Analytics ──────────────────────────────────────────────────────

  /** Get current usage statistics. */
  async getUsage(): Promise<UsageStats> {
    return this.request<UsageStats>('GET', '/portal/stats')
  }

  // ── Domain Management ───────────────────────────────────────────────────────

  /** Add a domain to a license. */
  async addDomain(licenseId: string, domain: string): Promise<{ success: boolean }> {
    return this.request('POST', `/portal/licenses/${licenseId}/domains`, { domain })
  }

  /** Remove a domain from a license. */
  async removeDomain(licenseId: string, domain: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/portal/licenses/${licenseId}/domains`, { domain })
  }

  /** Get domains for a license. */
  async getDomains(licenseId: string): Promise<{ domains: string[] }> {
    return this.request('GET', `/portal/licenses/${licenseId}`)
  }

  // ── License Lifecycle ─────────────────────────────────────────────────────

  /** Suspend or reactivate a license. */
  async updateLicenseStatus(licenseId: string, status: 'active' | 'suspended'): Promise<{ success: boolean }> {
    return this.request('PATCH', `/portal/licenses/${licenseId}`, { status })
  }

  /** Delete (revoke) a license permanently. */
  async deleteLicense(licenseId: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/portal/licenses/${licenseId}`)
  }

  // ── API Keys ──────────────────────────────────────────────────────────────

  /** List all API keys for the authenticated user. */
  async listApiKeys(): Promise<{
    this.requireApiKey('listApiKeys') keys: Array<{ id: string; name: string; prefix: string; created_at: string }> }> {
    return this.request('GET', '/portal/api-keys')
  }

  /** Create a new API key. */
  async createApiKey(name: string, scopes: string[] = ['read']): Promise<{
    this.requireApiKey('createApiKey') id: string; key: string; name: string }> {
    return this.request('POST', '/portal/api-keys', { name, scopes })
  }

  /** Delete an API key. */
  async deleteApiKey(keyId: string): Promise<{
    this.requireApiKey('deleteApiKey') success: boolean }> {
    return this.request('DELETE', `/portal/api-keys/${keyId}`)
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────

  /** Get webhook configurations for the authenticated user. */
  async getWebhookConfig(): Promise<{ configs: Array<Record<string, unknown>> }> {
    return this.request('GET', '/portal/webhooks')
  }

  /** Create a new webhook configuration. */
  async setWebhookConfig(url: string, events: string[] = ['*']): Promise<{ config_id: string; secret: string }> {
    return this.request('POST', '/portal/webhooks', { url, events })
  }

  /** Get detailed analytics for a specified number of days. */
  async getAnalytics(days: number = 30): Promise<Record<string, unknown>> {
    this.requireApiKey('getAnalytics')
    return this.request('GET', `/portal/analytics?days=${days}`)
  }

  // ── SLA & Compliance ──────────────────────────────────────────────────────

  /**
   * Get SLA compliance data: uptime, latency, error rates.
   * Available on all plans. Returns uptime percentage, avg latency, and compliance status.
   */
  async getSLA(days: number = 30): Promise<SLAData> {
    this.requireApiKey('getSla')
    return this.request<SLAData>('GET', `/portal/sla?days=${days}`)
  }

  // ── Audit & Export ────────────────────────────────────────────────────────

  /**
   * Export audit logs as JSON or CSV.
   * Requires Business or Enterprise plan.
   *
   * @param options.format - Export format: 'json' (default) or 'csv'
   * @param options.since - ISO-8601 date to filter logs from (default: 30 days ago)
   */
  async exportAuditLogs(options: { format?: 'json' | 'csv'; since?: string } = {}): Promise<AuditExportResult> {
    const params = new URLSearchParams()
    if (options.format) params.set('format', options.format)
    if (options.since) params.set('since', options.since)
    const qs = params.toString()
    return this.request<AuditExportResult>('GET', `/portal/audit-logs/export${qs ? '?' + qs : ''}`)
  }

  /** Get audit logs (requires Business or Enterprise plan). */
  async getAuditLogs(): Promise<{ logs: Array<Record<string, unknown>> }> {
    return this.request('GET', '/portal/audit')
  }

  // ── Webhook Delivery Logs ─────────────────────────────────────────────────

  /** Get webhook delivery history. */
  async getWebhookDeliveries(options: { limit?: number; status?: 'pending' | 'success' | 'failed' } = {}): Promise<WebhookDeliveriesResult> {
    const params = new URLSearchParams()
    if (options.limit) params.set('limit', String(options.limit))
    if (options.status) params.set('status', options.status)
    const qs = params.toString()
    return this.request('GET', `/portal/webhooks/deliveries${qs ? '?' + qs : ''}`)
  }

  // ── Batch License Operations ──────────────────────────────────────────────

  /** Perform batch operations on multiple licenses (suspend, activate, extend). */
  async batchLicenseOperation(action: 'suspend' | 'activate' | 'extend', licenseIds: string[], days?: number): Promise<BatchResult> {
    return this.request('POST', '/portal/licenses/batch', { action, licenseIds, ...(days ? { days } : {}) })
  }

  // ── IP Allowlist ──────────────────────────────────────────────────────────

  /** Get IP allowlist for a license. */
  async getIpAllowlist(licenseId: string): Promise<{ licenseId: string; allowedIps: string[] }> {
    return this.request('GET', `/portal/licenses/${licenseId}/ip-allowlist`)
  }

  /** Set IP allowlist for a license (replaces existing). */
  async setIpAllowlist(licenseId: string, allowedIps: string[]): Promise<{ success: boolean; allowedIps: string[] }> {
    return this.request('PUT', `/portal/licenses/${licenseId}/ip-allowlist`, { allowedIps })
  }

  // ── License Rotation ──────────────────────────────────────────────────────

  /** Rotate a license key. Old key immediately becomes invalid. */
  async rotateLicense(licenseId: string): Promise<{ newLicense: { key: string } }> {
    return this.request('POST', `/portal/licenses/${licenseId}/rotate`)
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /** Get full dashboard overview (licenses, usage, subscription). */
  async getDashboard(): Promise<Record<string, unknown>> {
    return this.request('GET', '/portal/dashboard')
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  /** Check API health status. */
  async healthCheck(): Promise<{ status: string; version: string }> {
    return this.request<{ status: string; version: string }>('GET', '/health')
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.apiUrl}${path}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeout)

        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        })

        clearTimeout(timer)

        const data = await res.json() as T & Partial<ApiError>

        if (!res.ok) {
          throw new TrafficOrchestratorError(
            (data as ApiError).error || `HTTP ${res.status}`,
            (data as ApiError).code,
            res.status
          )
        }

        return data as T
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e))

        // Don't retry on 4xx errors (client errors)
        if (e instanceof TrafficOrchestratorError && e.status < 500) throw e

        // Exponential backoff on retryable errors
        if (attempt < this.retries) {
          await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 5000)))
        }
      }
    }

    throw lastError!
  }
}

export default TrafficOrchestrator
