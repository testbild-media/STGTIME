import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'

const parseCookies = header => Object.fromEntries(String(header || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(parts => parts.length === 2))

export function verifyPassword(password, encoded) {
  const [, salt, expectedHex] = String(encoded).split('$')
  if (!salt || !expectedHex) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export class AuthManager {
  constructor({ getSecurity }) {
    this.getSecurity = getSecurity
    this.secret = randomBytes(32)
  }

  createSession() {
    const expires = Date.now() + 12 * 60 * 60 * 1000
    const value = `${expires}`
    const signature = createHmac('sha256', this.secret).update(value).digest('base64url')
    return `${value}.${signature}`
  }

  invalidateSessions() {
    this.secret = randomBytes(32)
  }

  sessionValid(req) {
    const token = parseCookies(req.headers.cookie).stgtime_session
    if (!token) return false
    const [expires, signature] = token.split('.')
    if (!expires || Number(expires) < Date.now() || !signature) return false
    const expected = createHmac('sha256', this.secret).update(expires).digest()
    const actual = Buffer.from(signature, 'base64url')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  authorized(req) {
    const security = this.getSecurity()
    if (security.webAuthMode === 'off') return true
    if (security.webAuthMode === 'ethernet-only') {
      const localAddress = String(req.socket.localAddress || '').replace(/^::ffff:/, '')
      const localInterface = Object.entries(networkInterfaces()).find(([, addresses]) => (addresses || []).some(item => item.address === localAddress))?.[0] || ''
      if (/^(wl|wlan)/i.test(localInterface)) return true
    }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const apiToken = req.headers['x-api-token'] || bearer
    return this.sessionValid(req) || Boolean(apiToken && apiToken === security.apiToken)
  }
}
