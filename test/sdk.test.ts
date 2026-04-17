import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock global fetch ──────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── Import after mocking ───────────────────────────────────────────────────

const { TrafficOrchestrator } = await import('../src/index')

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function mockResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('TrafficOrchestrator — Constructor', () => {
  it('should use production defaults', () => {
    const client = new TrafficOrchestrator()
    // Access private fields via bracket notation for testing
    expect((client as any).apiUrl).toBe('https://api.trafficorchestrator.com/api/v1')
    expect((client as any).apiKey).toBeUndefined()
    expect((client as any).timeout).toBe(10_000)
    expect((client as any).retries).toBe(2)
  })

  it('should accept custom config', () => {
    const client = new TrafficOrchestrator({
      apiUrl: 'https://staging.test.com/api/v1/',
      apiKey: 'sk_test_abc',
      timeout: 5000,
      retries: 0
    })
    expect((client as any).apiUrl).toBe('https://staging.test.com/api/v1')
    expect((client as any).apiKey).toBe('sk_test_abc')
    expect((client as any).timeout).toBe(5000)
    expect((client as any).retries).toBe(0)
  })

  it('should strip trailing slash from URL', () => {
    const client = new TrafficOrchestrator({ apiUrl: 'https://example.com/' })
    expect((client as any).apiUrl).toBe('https://example.com')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// request() — Auth, Retry, Error Handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('TrafficOrchestrator — request()', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should send GET request to correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 'ok' }))

    const client = new TrafficOrchestrator()
    await client.healthCheck()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.trafficorchestrator.com/api/v1/health')
    expect(opts.method).toBe('GET')
  })

  it('should send Authorization header when apiKey is set', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))

    const client = new TrafficOrchestrator({ apiKey: 'sk_live_xyz' })
    await client.healthCheck()

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers['Authorization']).toBe('Bearer sk_live_xyz')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('should NOT send Authorization header without apiKey', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))

    const client = new TrafficOrchestrator()
    await client.healthCheck()

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers['Authorization']).toBeUndefined()
  })

  it('should throw on 4xx error without retrying', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({ error: 'Unauthorized', code: 'AUTH_FAILED' }, false, 401)
    )

    const client = new TrafficOrchestrator({ retries: 3 })
    await expect(client.healthCheck()).rejects.toThrow('Unauthorized')

    // No retry on 4xx
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('should retry on 5xx errors', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ error: 'Server error' }, false, 500))
      .mockResolvedValueOnce(mockResponse({ status: 'ok' }, true))

    const client = new TrafficOrchestrator({ retries: 2 })
    const result = await client.healthCheck()

    expect(result).toEqual({ status: 'ok' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('should retry on network errors', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce(mockResponse({ status: 'ok' }, true))

    const client = new TrafficOrchestrator({ retries: 2 })
    const result = await client.healthCheck()

    expect(result).toEqual({ status: 'ok' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('should exhaust retries and throw last error', async () => {
    mockFetch.mockRejectedValue(new Error('Network down'))

    const client = new TrafficOrchestrator({ retries: 1 })
    await expect(client.healthCheck()).rejects.toThrow('Network down')

    // initial + 1 retry = 2 attempts
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('should not retry with zero retries', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'))

    const client = new TrafficOrchestrator({ retries: 0 })
    await expect(client.healthCheck()).rejects.toThrow('timeout')

    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('should send JSON body for POST requests', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ valid: true }))

    const client = new TrafficOrchestrator()
    await client.validateLicense('LK-1234')

    const opts = mockFetch.mock.calls[0][1]
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body)
    expect(body.token).toBe('LK-1234')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// API Methods
// ═══════════════════════════════════════════════════════════════════════════════

describe('TrafficOrchestrator — API Methods', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('validateLicense — sends token and optional domain', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ valid: true, plan: 'professional' }))

    const client = new TrafficOrchestrator()
    const result = await client.validateLicense('LK-1234', 'example.com')

    expect(result.valid).toBe(true)
    expect(result.plan).toBe('professional')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.token).toBe('LK-1234')
    expect(body.domain).toBe('example.com')
  })

  it('validateLicense — omits domain when not provided', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ valid: true }))

    const client = new TrafficOrchestrator()
    await client.validateLicense('LK-5678')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.token).toBe('LK-5678')
    expect(body.domain).toBeUndefined()
  })

  it('listLicenses — returns license array', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      licenses: [{ license_id: 'lic_1' }, { license_id: 'lic_2' }]
    }))

    const client = new TrafficOrchestrator({ apiKey: 'sk_live_test' })
    const licenses = await client.listLicenses()

    expect(licenses).toHaveLength(2)
    expect(licenses[0].license_id).toBe('lic_1')
  })

  it('listLicenses — returns empty array when no licenses', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ licenses: [] }))

    const client = new TrafficOrchestrator({ apiKey: 'sk_live_test' })
    expect(await client.listLicenses()).toEqual([])
  })

  it('listLicenses — handles missing licenses key', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}))

    const client = new TrafficOrchestrator({ apiKey: 'sk_live_test' })
    expect(await client.listLicenses()).toEqual([])
  })

  it('createLicense — sends appName with optional fields', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ license_id: 'lic_new', license_key: 'LK-xxxx' }))

    const client = new TrafficOrchestrator({ apiKey: 'sk_live_test' })
    const result = await client.createLicense({
      appName: 'My App',
      domain: 'myapp.com',
      planId: 'enterprise'
    })

    expect(result.license_id).toBe('lic_new')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.appName).toBe('My App')
    expect(body.domain).toBe('myapp.com')
    expect(body.planId).toBe('enterprise')
  })

  it('createLicense — sends only appName when no optionals', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ license_id: 'lic_min' }))

    const client = new TrafficOrchestrator({ apiKey: 'sk_live_test' })
    await client.createLicense({ appName: 'Minimal App' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.appName).toBe('Minimal App')
  })

  it('getUsage — returns usage stats', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      validationsToday: 42,
      validationsMonth: 1500,
      monthlyLimit: 5000,
      activeLicenses: 3,
      activeDomains: 7
    }))

    const client = new TrafficOrchestrator({ apiKey: 'sk_live_test' })
    const usage = await client.getUsage()

    expect(usage.validationsToday).toBe(42)
    expect(usage.activeLicenses).toBe(3)
    expect(usage.monthlyLimit).toBe(5000)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('/portal/stats')
  })

  it('healthCheck — returns status and version', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ status: 'healthy', version: '2.0.0' }))

    const client = new TrafficOrchestrator()
    const health = await client.healthCheck()

    expect(health.status).toBe('healthy')
    expect(health.version).toBe('2.0.0')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// verifyOffline — Ed25519 JWT
// ═══════════════════════════════════════════════════════════════════════════════

describe('TrafficOrchestrator.verifyOffline', () => {
  it('should return valid=false for invalid JWT', async () => {
    const result = await TrafficOrchestrator.verifyOffline('not-a-jwt', '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest=\n-----END PUBLIC KEY-----')
    expect(result.valid).toBe(false)
    expect(result.message).toBeDefined()
  })

  it('should return valid=false for empty token', async () => {
    const result = await TrafficOrchestrator.verifyOffline('', '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest=\n-----END PUBLIC KEY-----')
    expect(result.valid).toBe(false)
  })

  it('should return valid=false for invalid public key', async () => {
    const result = await TrafficOrchestrator.verifyOffline(
      'eyJhbGciOiJFZERTQSJ9.eyJ0ZXN0IjoxfQ.signature',
      'not-a-pem'
    )
    expect(result.valid).toBe(false)
    expect(result.message).toBeDefined()
  })

  it('should return ValidationResult shape on failure', async () => {
    const result = await TrafficOrchestrator.verifyOffline('bad', 'bad')
    expect(typeof result.valid).toBe('boolean')
    expect(result.valid).toBe(false)
    expect('message' in result).toBe(true)
  })
})
