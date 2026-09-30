/* 尤诺皮肤宿主插件 —— 离线冒烟测试（web 版）
 * 用假 ctx 挂载 lib/index.js，检查：路由注册、tapIndex 注入、静态资源、
 * 配置读写、壁纸上传、余额（账号钱包合成 / API key 回退）。
 * 不改动真实 profile：DSH_HOME 指向临时目录。
 *
 * 用法：node tools/smoke-host.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'

const PKG = path.resolve(import.meta.dirname, '..')
const TMP = path.join(process.env.TEMP, 'dsh-iuno-web-smoke')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
process.env.DSH_HOME = TMP

function makeCtx({ account } = {}) {
  const routes = new Map()
  const taps = []
  const cleanups = []
  const ctx = {
    webServer: {
      register(route) {
        assert.equal(routes.has(route.path), false, 'duplicate route ' + route.path)
        assert.equal(route.kind, 'exact')
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
      tapIndex(transform) {
        taps.push(transform)
        return () => {}
      },
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return () => {}
    },
    get(name) {
      if (name === 'deepseekAccount') return account
      return undefined
    },
    credentials: { resolve: async () => undefined },
    logger: () => ({ warn() {}, info() {}, error() {} }),
  }
  return { ctx, routes, taps }
}

function fakeRes() {
  const res = new EventEmitter()
  res.status = null
  res.headers = null
  res.body = null
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers || {} }
  res.end = (body) => { res.body = body }
  return res
}

function fakeReq(method, url, body, headers = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(body))
    req.emit('end')
  })
  return req
}

const results = []
const ok = (name, extra = '') => results.push('  ok   ' + name + (extra ? '  ' + extra : ''))

const mod = await import(pathToFileURL(path.join(PKG, 'lib', 'index.js')).href)
assert.equal(mod.name, 'iuno-moon-widget')
assert.deepEqual(mod.inject, ['webServer', 'credentials'])

/* ── 1. 未登录 / 无 API key：路由 + tapIndex 注入 + 静态资源 ─────────────── */
{
  const { ctx, routes, taps } = makeCtx()
  mod.apply(ctx)

  const expected = [
    '/dsh-iuno/wall.jpg', '/dsh-iuno/pet.png', '/dsh-iuno/size.json', '/dsh-iuno/balance.json',
    '/dsh-iuno/theme.css', '/dsh-iuno/pet.css',
    '/dsh-iuno/theme.js', '/dsh-iuno/pet.js', '/dsh-iuno/trail.js',
  ]
  for (const p of expected) assert.ok(routes.has(p), 'missing route ' + p)
  ok('注册 ' + routes.size + ' 条精确路由')

  // tapIndex：皮肤 CSS 必须晚于应用自身 CSS（插在 </head> 前），且重复应用不叠加
  assert.equal(taps.length, 1)
  const html = '<html><head><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div></body></html>'
  const out = taps[0](html)
  assert.ok(out.indexOf('/assets/app.css') < out.indexOf('/dsh-iuno/theme.css'), '皮肤 CSS 必须晚于应用自身 CSS')
  assert.ok(out.indexOf('/dsh-iuno/theme.css') < out.indexOf('</head>'), 'theme.css 应插在 </head> 之前')
  for (const tag of ['/dsh-iuno/theme.css', '/dsh-iuno/pet.css', '/dsh-iuno/theme.js', '/dsh-iuno/pet.js', '/dsh-iuno/trail.js']) {
    assert.ok(out.includes(tag), '注入缺失 ' + tag)
  }
  assert.ok(out.includes('<script defer src="/dsh-iuno/theme.js"></script>'))
  assert.ok(out.indexOf('/dsh-iuno/theme.js') < out.indexOf('</body>'), '脚本应插在 </body> 之前')
  assert.equal(taps[0](out), out, '重复应用 tapIndex 不应重复注入')
  ok('tapIndex 注入 5 个标签且幂等（CSS 晚于应用样式）')

  async function get(p) {
    const res = fakeRes()
    await routes.get(p).handler(fakeReq('GET', p), res)
    return res
  }

  const css = await get('/dsh-iuno/theme.css')
  assert.equal(css.status, 200)
  assert.equal(css.headers['Content-Type'], 'text/css; charset=utf-8')
  assert.equal(css.headers['Cache-Control'], 'no-store')
  assert.match(String(css.body), /--yn-gold/)
  // 这两个修正必须落在文件里
  assert.match(String(css.body), /_newSession"\]:not\(\[class\*="Label"\]\):not\(\[class\*="Content"\]\)/)
  assert.match(String(css.body), /titleGroup/)
  ok('theme.css 路由（含新会话 / 标题文字修正）', String(css.body).length + ' 字符')

  const wall = await get('/dsh-iuno/wall.jpg')
  assert.equal(wall.status, 200)
  assert.equal(wall.body.length, fs.statSync(path.join(PKG, 'assets', 'iuno-wall.jpg')).size)
  ok('内置壁纸路由', wall.body.length + ' 字节')

  const pet = await get('/dsh-iuno/pet.png')
  assert.equal(pet.headers['Content-Type'], 'image/png')
  ok('桌宠贴图路由', pet.body.length + ' 字节')

  const js = await get('/dsh-iuno/pet.js')
  assert.match(String(js.body), /yn-pet-balance-tip-main/)
  assert.match(String(js.body), /重启 dsh web/)
  ok('pet.js 路由（余额小签按分显示）')

  const size = await get('/dsh-iuno/size.json')
  assert.equal(JSON.parse(String(size.body)).wallBrightness, 0.86)
  ok('size.json 默认值')

  const res = fakeRes()
  await routes.get('/dsh-iuno/size.json').handler(
    fakeReq('POST', '/dsh-iuno/size.json', JSON.stringify({ wallBrightness: 0.62 }), { 'content-type': 'application/json' }),
    res,
  )
  assert.equal(JSON.parse(String(res.body)).wallBrightness, 0.62)
  const stateFile = path.join(TMP, '.dshy-size.json')
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).wallBrightness, 0.62)
  ok('写配置落到 $DSH_HOME/.dshy-size.json')

  const up = fakeRes()
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3])
  await routes.get('/dsh-iuno/wall.jpg').handler(
    fakeReq('POST', '/dsh-iuno/wall.jpg', bytes, { 'content-type': 'image/jpeg' }),
    up,
  )
  assert.equal(JSON.parse(String(up.body)).ok, true)
  assert.deepEqual(fs.readFileSync(path.join(TMP, '.dshy-wall-custom.bin')), bytes)
  assert.deepEqual((await get('/dsh-iuno/wall.jpg')).body, bytes)
  const reset = fakeRes()
  await routes.get('/dsh-iuno/wall.jpg').handler(fakeReq('POST', '/dsh-iuno/wall.jpg?reset=1'), reset)
  assert.equal(JSON.parse(String(reset.body)).wallCustom, false)
  ok('自定义壁纸上传 / 复位往返')

  const bal = await get('/dsh-iuno/balance.json')
  const balJson = JSON.parse(String(bal.body))
  assert.equal(balJson.ok, false)
  assert.match(balJson.error, /未登录账号/)
  ok('余额回退提示', balJson.error)
}

/* ── 2. 已登录账号：充值 + 赠送两组钱包，合成可用余额 ───────────────────── */
{
  const calls = []
  const account = {
    async getState() { return { status: 'credential-stored', links: {}, attempt: null } },
    async getBalance(client) {
      calls.push(client)
      return {
        status: 'ready',
        // 平台返回的是带长尾数的十进制字符串，必须归一成「分」
        value: [{ currency: 'CNY', balance: '9.957584100000000' }],
        bonusWallets: [{ currency: 'CNY', balance: '5.350802880000000' }],
      }
    },
  }
  const { ctx, routes } = makeCtx({ account })
  mod.apply(ctx)
  const res = fakeRes()
  await routes.get('/dsh-iuno/balance.json').handler(fakeReq('GET', '/dsh-iuno/balance.json'), res)
  const body = JSON.parse(String(res.body))
  assert.equal(body.source, 'account')
  assert.deepEqual(body.balances, [{ currency: 'CNY', total: 15.31, toppedUp: 9.96, granted: 5.35 }])
  assert.equal(calls.length, 1)
  ok('账号钱包：充值+赠送 合成可用余额', JSON.stringify(body.balances))
}

/* ── 3. 多币种 + 只有赠送余额 ──────────────────────────────────────────── */
{
  const account = {
    async getState() { return { status: 'credential-stored', links: {}, attempt: null } },
    async getBalance() {
      return {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '0' }, { currency: 'USD', balance: '1.005' }],
        bonusWallets: [{ currency: 'USD', balance: '0.5' }],
      }
    },
  }
  const { ctx, routes } = makeCtx({ account })
  mod.apply(ctx)
  const res = fakeRes()
  await routes.get('/dsh-iuno/balance.json').handler(fakeReq('GET', '/dsh-iuno/balance.json'), res)
  const body = JSON.parse(String(res.body))
  assert.deepEqual(body.balances, [
    { currency: 'CNY', total: 0, toppedUp: 0, granted: 0 },
    { currency: 'USD', total: 1.51, toppedUp: 1.01, granted: 0.5 },
  ])
  ok('多币种钱包合并', JSON.stringify(body.balances))
}

/* ── 4. 缓存与强制刷新：无 force 走宿主 60s 缓存，?force=1 必须重新查 ────── */
{
  let calls = 0
  const account = {
    async getState() { return { status: 'credential-stored', links: {}, attempt: null } },
    async getBalance() {
      calls++
      return { status: 'ready', value: [{ currency: 'CNY', balance: String(10 + calls) }], bonusWallets: [] }
    },
  }
  const { ctx, routes } = makeCtx({ account })
  mod.apply(ctx)
  const get = async (q) => {
    const res = fakeRes()
    await routes.get('/dsh-iuno/balance.json').handler(fakeReq('GET', '/dsh-iuno/balance.json' + (q || '')), res)
    return JSON.parse(String(res.body))
  }
  const a = await get()
  assert.equal(a.balances[0].total, 11)
  assert.equal(calls, 1)
  const b = await get()
  assert.equal(b.balances[0].total, 11)
  assert.equal(calls, 1, '第二次（无 force）应命中缓存')
  const c = await get('?force=1')
  assert.equal(c.balances[0].total, 12, '?force=1 应重新查询')
  assert.equal(calls, 2)
  const d = await get('?force=1')
  assert.equal(d.balances[0].total, 13)
  assert.equal(calls, 3)
  ok('余额缓存：无 force 命中缓存，?force=1 强制刷新', 'calls=' + calls)
}

console.log(results.join('\n'))
console.log('\n全部通过：' + results.length + ' 项')
