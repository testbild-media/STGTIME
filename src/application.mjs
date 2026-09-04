import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { URL } from 'node:url'
import { hashPassword } from './core/config-store.mjs'
import { normalizePreset, proportionalPresetThresholds } from './core/preset.mjs'
import { verifyPassword } from './auth.mjs'
import { encodePng } from './display/framebuffer.mjs'

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }

async function body(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) throw Object.assign(new Error('Body too large'), { status: 413 }); chunks.push(chunk) }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }) }
}

function json(res, status, value) {
  const data = Buffer.from(JSON.stringify(value))
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store' }); res.end(data)
}

const safeConfig = config => ({ ...config, security: { webAuthMode: config.security.webAuthMode, apiTokenConfigured: Boolean(config.security.apiToken) } })

export function createHandler(context) {
  const { timer, store, auth, network, system, updates, version = 'unknown', getFrame, webRoot, logoPath } = context
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://stgtime.local')
      const method = req.method || 'GET'
      const publicRoute = url.pathname === '/api/v1/health' || url.pathname === '/api/v1/auth/login' || !url.pathname.startsWith('/api/')

      if (!publicRoute && !auth.authorized(req)) return json(res, 401, { error: 'authentication_required' })

      if (method === 'GET' && url.pathname === '/api/v1/health') return json(res, 200, { status: 'ok', version })
      if (method === 'POST' && url.pathname === '/api/v1/auth/login') {
        const input = await body(req)
        if (!verifyPassword(String(input.password || ''), store.get().security.passwordHash)) return json(res, 401, { error: 'invalid_credentials' })
        res.setHeader('set-cookie', `stgtime_session=${auth.createSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`)
        return json(res, 200, { authenticated: true })
      }
      if (method === 'POST' && url.pathname === '/api/v1/auth/logout') {
        res.setHeader('set-cookie', 'stgtime_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        return json(res, 200, { authenticated: false })
      }
      if (method === 'GET' && url.pathname === '/api/v1/state') return json(res, 200, context.state())
      if (method === 'GET' && url.pathname === '/api/v1/config') return json(res, 200, safeConfig(store.get()))
      if (method === 'GET' && url.pathname === '/api/v1/display.png') {
        const png = encodePng(getFrame()); res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store' }); return res.end(png)
      }
      if (method === 'POST' && url.pathname === '/api/v1/timer/action') {
        const input = await body(req); const action = input.action
        if (!['start', 'stop', 'toggle', 'reset'].includes(action)) return json(res, 400, { error: 'invalid_action' })
        timer[action](); return json(res, 200, context.state())
      }
      if (method === 'PUT' && url.pathname === '/api/v1/timer') {
        const input = await body(req)
        if (input.mode !== undefined || input.continueNegative !== undefined) timer.configure({ mode: input.mode, continueNegative: input.continueNegative })
        if (Number.isFinite(input.durationMs)) timer.setTime(input.durationMs)
        if (Number.isFinite(input.jogMs)) timer.jog(input.jogMs)
        const patch = { timer: {} }
        if (input.mode !== undefined) patch.timer.mode = input.mode
        if (input.continueNegative !== undefined) patch.timer.continueNegative = Boolean(input.continueNegative)
        if (Number.isFinite(input.durationMs)) patch.timer.durationMs = Math.max(0, Math.trunc(input.durationMs))
        if (Object.keys(patch.timer).length) await store.update(patch)
        return json(res, 200, context.state())
      }
      if (method === 'PUT' && url.pathname === '/api/v1/config') {
        const input = await body(req)
        delete input.security
        if (input.display?.timeZone !== undefined) {
          const timeZone = String(input.display.timeZone).trim()
          try { new Intl.DateTimeFormat('en', { timeZone }).format() } catch { return json(res, 400, { error: 'invalid_time_zone' }) }
          if (system) await system.setTimeZone(timeZone)
          input.display.timeZone = timeZone
        }
        const updated = await store.update(input)
        context.settingsChanged(updated); return json(res, 200, safeConfig(updated))
      }
      if (method === 'PUT' && url.pathname === '/api/v1/message') {
        const input = await body(req)
        const message = {}
        if (input.visible !== undefined) message.visible = Boolean(input.visible)
        if (input.text !== undefined) message.text = String(input.text).trim().slice(0, 64)
        if (input.color !== undefined) message.color = String(input.color)
        if (!Object.keys(message).length) return json(res, 400, { error: 'no_message_fields' })
        const updated = await store.update({ message })
        context.settingsChanged(updated); return json(res, 200, updated.message)
      }
      if (method === 'PUT' && url.pathname === '/api/v1/video') {
        const input = await body(req)
        const video = { visible: Boolean(input.visible), label: String(input.label || 'VIDEO').slice(0, 8), remainingMs: Math.max(0, Number(input.remainingMs) || 0), durationMs: Math.max(0, Number(input.durationMs) || 0) }
        const updated = await store.update({ video }); context.settingsChanged(updated); return json(res, 200, updated.video)
      }
      if (method === 'POST' && url.pathname.startsWith('/api/v1/presets/')) {
        const id = decodeURIComponent(url.pathname.split('/').at(-1)); const preset = store.get().presets.find(item => item.id === id)
        if (!preset) return json(res, 404, { error: 'preset_not_found' })
        const thresholdsMs = preset.thresholdsMs || proportionalPresetThresholds(preset.durationMs)
        timer.setTime(preset.durationMs)
        const updated = await store.update({ timer: { durationMs: preset.durationMs, thresholdsMs } })
        context.settingsChanged(updated)
        return json(res, 200, context.state())
      }
      if (method === 'PUT' && url.pathname === '/api/v1/presets') {
        const input = await body(req)
        if (!Array.isArray(input.presets) || input.presets.length > 32) return json(res, 400, { error: 'invalid_presets' })
        const presets = input.presets.map((item, index) => normalizePreset(item, index))
        const updated = await store.update({ presets }); context.settingsChanged(updated); return json(res, 200, { presets: updated.presets })
      }
      if (method === 'PUT' && url.pathname === '/api/v1/security/password') {
        const input = await body(req)
        const currentPassword = String(input.currentPassword || '')
        const newPassword = String(input.newPassword || '')
        if (!verifyPassword(currentPassword, store.get().security.passwordHash)) return json(res, 403, { error: 'current_password_is_incorrect' })
        if (newPassword.length < 8) return json(res, 400, { error: 'password_must_have_8_characters' })
        await store.update({ security: { passwordHash: hashPassword(newPassword) } })
        auth.invalidateSessions()
        res.setHeader('set-cookie', 'stgtime_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        return json(res, 200, { changed: true, reauthenticationRequired: true })
      }
      if (method === 'PUT' && url.pathname === '/api/v1/security/mode') {
        const input = await body(req); const allowed = ['always', 'ethernet-only', 'off']
        if (!allowed.includes(input.webAuthMode)) return json(res, 400, { error: 'invalid_auth_mode' })
        await store.update({ security: { webAuthMode: input.webAuthMode } }); return json(res, 200, { webAuthMode: input.webAuthMode })
      }
      if (method === 'GET' && url.pathname === '/api/v1/security/api-token') return json(res, 200, { apiToken: store.get().security.apiToken })
      if (method === 'POST' && url.pathname === '/api/v1/security/api-token/rotate') {
        const { randomBytes } = await import('node:crypto')
        const apiToken = randomBytes(24).toString('base64url')
        await store.update({ security: { apiToken } }); return json(res, 200, { apiToken })
      }
      if (method === 'GET' && url.pathname === '/api/v1/network') return json(res, 200, { addresses: network.addresses(), ethernet: await network.ethernetStatus(), settings: store.get().network })
      if (method === 'POST' && url.pathname === '/api/v1/network/apply') {
        const input = await body(req); const allowed = ['hotspot-on', 'hotspot-off', 'ethernet-dhcp', 'ethernet-static']
        if (!allowed.includes(input.action)) return json(res, 400, { error: 'invalid_network_action' })
        return json(res, 200, await network.apply(input.action, store.get().network))
      }
      if (method === 'GET' && url.pathname === '/api/v1/update') return json(res, 200, await updates.check())
      if (method === 'GET' && url.pathname === '/api/v1/update/status') return json(res, 200, await updates.status())
      if (method === 'POST' && url.pathname === '/api/v1/update/install') {
        const input = await body(req)
        if (!verifyPassword(String(input.password || ''), store.get().security.passwordHash)) return json(res, 403, { error: 'admin_password_required' })
        return json(res, 202, await updates.installLatest())
      }
      if (method === 'POST' && url.pathname === '/api/v1/update/upload') {
        if (!verifyPassword(String(req.headers['x-stgtime-admin-password'] || ''), store.get().security.passwordHash)) return json(res, 403, { error: 'admin_password_required' })
        return json(res, 202, await updates.upload(req))
      }

      if (method !== 'GET') return json(res, 404, { error: 'not_found' })
      let filePath
      if (url.pathname === '/assets/logo.svg' && logoPath) filePath = logoPath
      else {
        const relative = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '')
        filePath = join(webRoot, relative)
        if (!filePath.startsWith(webRoot)) return json(res, 403, { error: 'forbidden' })
      }
      try {
        const data = await readFile(filePath); res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream', 'content-length': data.length, 'cache-control': 'no-store, max-age=0', pragma: 'no-cache', expires: '0' }); return res.end(data)
      } catch { return json(res, 404, { error: 'not_found' }) }
    } catch (error) { return json(res, error.status || 500, { error: error.status ? error.message : 'internal_error' }) }
  }
}
