import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// dsh-iuno-widget · v0.4.0 — 整站皮肤插件（已移除挂件与计费功能）
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

const ASSET_CANDIDATES = {
  wall: [path.join(PACKAGE_ROOT, 'assets', 'iuno-wall.jpg'), path.join(PACKAGE_ROOT, 'assets', 'iuno-wall.png')],
  pet: [path.join(PACKAGE_ROOT, 'assets', 'iuno-pet.png')],
}

const SIZE_FILE_CANDIDATES = [
  path.join(DSH_HOME, '.dshy-size.json'),
  path.join(DSH_HOME, 'profiles', 'web', '.dshy-size.json'),
]

function readTextFile(p, fallback) {
  try { return fs.readFileSync(p, 'utf8') } catch (e) { return fallback }
}

function readBytes(p) {
  try { return fs.readFileSync(p) } catch (e) { return null }
}

const name = 'iuno-moon-widget'
const inject = ['webServer', 'credentials']

function apply(ctx) {
  let wallBytes = null
  const disposers = []

  function loadWall() {
    if (wallBytes) return wallBytes
    for (const p of ASSET_CANDIDATES.wall) {
      const b = readBytes(p)
      if (b && b.length) { wallBytes = b; return b }
    }
    throw new Error('iuno wallpaper not found')
  }

  let petBytes = null
  function loadPet() {
    if (petBytes) return petBytes
    for (const p of ASSET_CANDIDATES.pet) {
      const b = readBytes(p)
      if (b && b.length) { petBytes = b; return b }
    }
    return null
  }

  function readSize() {
    for (const p of SIZE_FILE_CANDIDATES) {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
        return {
          ambience: typeof parsed.ambience === 'number' ? Math.max(0, Math.min(1, parsed.ambience)) : 1,
        }
      } catch (e) {}
    }
    return { ambience: 1 }
  }

  function writeSize(v) {
    const n = typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 1
    const body = JSON.stringify({ ambience: n, updatedAt: new Date().toISOString() }, null, 0)
    for (const p of SIZE_FILE_CANDIDATES) {
      try { fs.writeFileSync(p, body, 'utf8'); return { ok: true, ambience: n } } catch (e) {}
    }
    return { ok: false, error: '无法持久化界面配置' }
  }

  // ── 路由 ──────────────────────────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/wall.jpg',
    handler: (req, res) => {
      try {
        const bytes = loadWall()
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store',
          'Content-Length': String(bytes.length),
        })
        res.end(bytes)
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('iuno wallpaper unavailable: ' + String(e.message || e))
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/theme.css',
    handler: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(readTextFile(path.join(PACKAGE_ROOT, 'lib', 'theme.css'), ''))
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/theme.js',
    handler: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(readTextFile(path.join(PACKAGE_ROOT, 'lib', 'theme.js'), ''))
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/pet.png',
    handler: (req, res) => {
      const bytes = loadPet()
      if (!bytes) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('iuno pet sprite unavailable')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Length': String(bytes.length),
      })
      res.end(bytes)
    },
  }))

  // ── 余额：服务端读取 DeepSeek API key 调 /user/balance（60s 缓存）─────────
  let balanceCache = { at: 0, body: null }
  async function fetchBalance() {
    if (balanceCache.body && Date.now() - balanceCache.at < 60e3) return balanceCache.body
    let body
    try {
      const creds = ctx.credentials || (ctx.get && ctx.get('credentials'))
      const hit = creds && (await creds.resolve('DEEPSEEK_API_KEY'))
      if (!hit || !hit.value) {
        body = { ok: false, error: '未找到 DEEPSEEK_API_KEY，请在模型设置里配置' }
      } else {
        const base = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), 8000)
        try {
          const resp = await fetch(base + '/user/balance', {
            headers: { authorization: 'Bearer ' + hit.value, accept: 'application/json' },
            signal: ac.signal,
          })
          if (!resp.ok) throw new Error('HTTP ' + resp.status)
          const data = await resp.json()
          const infos = Array.isArray(data && data.balance_infos) ? data.balance_infos : []
          body = {
            ok: true,
            balances: infos.map((b) => ({
              currency: b.currency,
              total: b.total_balance,
              granted: b.granted_balance,
              toppedUp: b.topped_up_balance,
            })),
          }
        } finally {
          clearTimeout(timer)
        }
      }
    } catch (e) {
      body = { ok: false, error: '余额查询失败：' + String((e && e.message) || e) }
    }
    balanceCache = { at: Date.now(), body }
    return body
  }

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/balance.json',
    handler: async (req, res) => {
      const body = await fetchBalance()
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify(body))
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/pet.css',
    handler: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(readTextFile(path.join(PACKAGE_ROOT, 'lib', 'pet.css'), ''))
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/pet.js',
    handler: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(readTextFile(path.join(PACKAGE_ROOT, 'lib', 'pet.js'), ''))
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/trail.js',
    handler: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(readTextFile(path.join(PACKAGE_ROOT, 'lib', 'trail.js'), ''))
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/size.json',
    handler: async (req, res) => {
      try {
        if (req.method === 'PUT' || req.method === 'POST') {
          const chunks = []
          let size = 0
          await new Promise((resolve, reject) => {
            req.on('data', c => { size += c.length; if (size > 4096) reject(new Error('body too large')); chunks.push(c) })
            req.on('end', resolve)
            req.on('error', reject)
          })
          let body
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'invalid json' }))
            return
          }
          const result = writeSize(body && body.ambience)
          res.writeHead(result.ok ? 200 : 500, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          })
          res.end(JSON.stringify(result))
          return
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        })
        res.end(JSON.stringify(readSize()))
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ambience: 1 }))
      }
    },
  }))

  // ── 注入：CSS 进 head（首帧即换肤），JS 进 </body> 前 ──────────────────
  disposers.push(ctx.webServer.tapIndex((html) => {
    let out = html
    if (out.indexOf('/dsh-iuno/theme.css') === -1) {
      const link = '<link rel="stylesheet" href="/dsh-iuno/theme.css">'
      out = out.indexOf('</head>') !== -1 ? out.replace('</head>', link + '</head>') : link + out
    }
    if (out.indexOf('/dsh-iuno/pet.css') === -1) {
      const petCss = '<link rel="stylesheet" href="/dsh-iuno/pet.css">'
      out = out.indexOf('</head>') !== -1 ? out.replace('</head>', petCss + '</head>') : petCss + out
    }
    if (out.indexOf('/dsh-iuno/theme.js') === -1) {
      const tag = '<script defer src="/dsh-iuno/theme.js"></script>'
      out = out.indexOf('</body>') !== -1 ? out.replace('</body>', tag + '</body>') : out + tag
    }
    if (out.indexOf('/dsh-iuno/pet.js') === -1) {
      const tag = '<script defer src="/dsh-iuno/pet.js"></script>'
      out = out.indexOf('</body>') !== -1 ? out.replace('</body>', tag + '</body>') : out + tag
    }
    if (out.indexOf('/dsh-iuno/trail.js') === -1) {
      const tag = '<script defer src="/dsh-iuno/trail.js"></script>'
      out = out.indexOf('</body>') !== -1 ? out.replace('</body>', tag + '</body>') : out + tag
    }
    return out
  }))

  ctx.effect(() => () => {
    for (const d of disposers) { try { d() } catch (e) {} }
  })
}

export { name, inject, apply }
