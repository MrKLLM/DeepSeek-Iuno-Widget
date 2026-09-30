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

// 用户自定义壁纸：二进制 + 内容类型（存在 size.json 的 wallType 字段里）
const WALL_CUSTOM_CANDIDATES = [
  path.join(DSH_HOME, '.dshy-wall-custom.bin'),
  path.join(DSH_HOME, 'profiles', 'web', '.dshy-wall-custom.bin'),
]

const DEFAULT_WALL_BRIGHTNESS = 0.86
const WALL_BRIGHTNESS_MIN = 0.4
const WALL_BRIGHTNESS_MAX = 1.0
// 自定义壁纸上传上限 ~20MB
const WALL_UPLOAD_MAX = 20 * 1024 * 1024

function clampBrightness(v) {
  const n = Number(v)
  if (!isFinite(n)) return DEFAULT_WALL_BRIGHTNESS
  return Math.round(Math.max(WALL_BRIGHTNESS_MIN, Math.min(WALL_BRIGHTNESS_MAX, n)) * 100) / 100
}

/** 金额按「分」归一（平台返回的字符串尾数很长，直接透出会变成 9.957584100000000）。
 *  加 1e-9 是半分向上取整的浮点补丁：1.005 在 IEEE754 里是 1.00499999…，
 *  直接 *100 会掉成 1.00。 */
function round2(v) {
  const n = Number(v)
  if (!isFinite(n)) return 0
  return Math.round(n * 100 + 1e-9) / 100
}

function readCustomWallPath() {
  for (const p of WALL_CUSTOM_CANDIDATES) {
    try { if (fs.existsSync(p)) return p } catch (e) {}
  }
  return null
}

function writeCustomWall(bytes, contentType) {
  // 写到第一个可写位置；内容类型记进 size.json（wallType）
  for (const p of WALL_CUSTOM_CANDIDATES) {
    try {
      fs.writeFileSync(p, bytes)
      return { ok: true, path: p, contentType }
    } catch (e) {}
  }
  return { ok: false, error: '无法写入自定义壁纸文件' }
}

function deleteCustomWall() {
  let any = false
  for (const p of WALL_CUSTOM_CANDIDATES) {
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); any = true } } catch (e) {}
  }
  return any
}

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
          wallBrightness: clampBrightness(parsed.wallBrightness),
          wallType: typeof parsed.wallType === 'string' && parsed.wallType ? parsed.wallType : 'image/jpeg',
          wallCustom: !!readCustomWallPath(),
        }
      } catch (e) {}
    }
    return { ambience: 1, wallBrightness: DEFAULT_WALL_BRIGHTNESS, wallType: 'image/jpeg', wallCustom: false }
  }

  // 合并写入：只更新传入的字段，其余保留
  function writeSize(patch) {
    const cur = readSize()
    const next = {
      ambience: typeof patch.ambience === 'number' ? Math.max(0, Math.min(1, patch.ambience)) : cur.ambience,
      wallBrightness: typeof patch.wallBrightness === 'number' ? clampBrightness(patch.wallBrightness) : cur.wallBrightness,
      wallType: typeof patch.wallType === 'string' && patch.wallType ? patch.wallType : cur.wallType,
      updatedAt: new Date().toISOString(),
    }
    const body = JSON.stringify(next, null, 0)
    for (const p of SIZE_FILE_CANDIDATES) {
      try { fs.writeFileSync(p, body, 'utf8'); return { ok: true, ...next } } catch (e) {}
    }
    return { ok: false, error: '无法持久化界面配置' }
  }

  // ── 路由 ──────────────────────────────────────────────────────────────────
  function sendWall(req, res, bytes, contentType) {
    res.writeHead(200, {
      'Content-Type': contentType || 'image/jpeg',
      'Cache-Control': 'no-store',
      'Content-Length': String(bytes.length),
    })
    res.end(bytes)
  }

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-iuno/wall.jpg',
    handler: async (req, res) => {
      try {
        // POST = 上传自定义壁纸；?reset=1 = 恢复默认
        if (req.method === 'POST' || req.method === 'PUT') {
          const url = new URL(req.url, 'http://x')
          if (url.searchParams.get('reset') === '1') {
            deleteCustomWall()
            writeSize({ wallType: 'image/jpeg' })
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            })
            res.end(JSON.stringify({ ok: true, wallCustom: false }))
            return
          }
          const chunks = []
          let size = 0
          await new Promise((resolve, reject) => {
            req.on('data', c => { size += c.length; if (size > WALL_UPLOAD_MAX) reject(new Error('image too large')); chunks.push(c) })
            req.on('end', resolve)
            req.on('error', reject)
          })
          const bytes = Buffer.concat(chunks)
          let ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
          if (!ct || !/^image\//.test(ct)) ct = 'image/jpeg'
          const r = writeCustomWall(bytes, ct)
          if (r.ok) writeSize({ wallType: ct })
          res.writeHead(r.ok ? 200 : 500, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          })
          res.end(JSON.stringify(r))
          return
        }
        // GET = 有自定义就给自定义，否则给内置
        const customPath = readCustomWallPath()
        if (customPath) {
          const bytes = readBytes(customPath)
          if (bytes && bytes.length) {
            const s = readSize()
            sendWall(req, res, bytes, s.wallType || 'image/jpeg')
            return
          }
        }
        const bytes = loadWall()
        sendWall(req, res, bytes, 'image/jpeg')
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

  // ── 余额：优先读登录账号钱包，否则用 DEEPSEEK_API_KEY 调 /user/balance（60s 缓存）──
  let balanceCache = { at: 0, body: null }

  /** 登录账号（deepseek-account）钱包余额；未登录或服务缺失时返回 null 交给回退。 */
  async function readAccountBalance() {
    try {
      const account = ctx.get && ctx.get('deepseekAccount')
      if (!account) return null
      const state = await account.getState()
      if (!state || state.status !== 'credential-stored') return null
      const details = await account.getBalance({
        version: process.env.DSH_CLIENT_VERSION || '0.0.0',
        locale: 'zh-CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })
      if (!details || details.status !== 'ready') return { ok: false, error: '账号钱包暂时读不到，稍后再试' }
      /* Platform 的 get_user_summary 返回两组互不重叠的钱包：
       *   normal_wallets → details.value        （充值余额）
       *   bonus_wallets  → details.bonusWallets （赠送余额）
       * 可用余额 = 两者之和；分两个字段给前端，便于显示「¥15.31 · 赠送 ¥5.35」。
       * 金额是十进制字符串且带一长串尾数（如 "9.957584100000000"），
       * 这里按分（2 位小数）归一，避免前端出现 9.957584100000000。 */
      const wallets = new Map()
      const collect = (list, key) => {
        for (const w of list || []) {
          const cur = wallets.get(w.currency) || { currency: w.currency, normal: 0, bonus: 0 }
          const n = Number(w.balance)
          cur[key] += isFinite(n) ? n : 0
          wallets.set(w.currency, cur)
        }
      }
      collect(details.value, 'normal')
      collect(details.bonusWallets, 'bonus')
      return {
        ok: true,
        source: 'account',
        balances: [...wallets.values()].map((c) => ({
          currency: c.currency,
          total: round2(c.normal + c.bonus),
          toppedUp: round2(c.normal),
          granted: round2(c.bonus),
        })),
      }
    } catch (e) {
      return { ok: false, error: '账号余额查询失败：' + String((e && e.message) || e) }
    }
  }

  /** 回退：本地 DEEPSEEK_API_KEY 调官方 /user/balance。 */
  async function readApiKeyBalance() {
    try {
      const creds = ctx.credentials || (ctx.get && ctx.get('credentials'))
      const hit = creds && (await creds.resolve('DEEPSEEK_API_KEY'))
      if (!hit || !hit.value) {
        return { ok: false, error: '未登录账号，也未找到 DEEPSEEK_API_KEY，请在模型设置里配置' }
      }
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
        return {
          ok: true,
          source: 'api-key',
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
    } catch (e) {
      return { ok: false, error: '余额查询失败：' + String((e && e.message) || e) }
    }
  }

  async function fetchBalance() {
    if (balanceCache.body && Date.now() - balanceCache.at < 60e3) return balanceCache.body
    const account = await readAccountBalance()
    const body = account !== null ? account : await readApiKeyBalance()
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
          const result = writeSize({
            ambience: body && typeof body.ambience === 'number' ? body.ambience : undefined,
            wallBrightness: body && typeof body.wallBrightness === 'number' ? body.wallBrightness : undefined,
          })
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
        res.end(JSON.stringify({ ambience: 1, wallBrightness: DEFAULT_WALL_BRIGHTNESS, wallCustom: false }))
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
