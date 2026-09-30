/* 皮肤选择器体检 —— 拿皮肤里的 [class*="…"] 规则去撞 DeepSeek Harness 真实构建出来的类名。
 *
 * 为什么需要它：DSH 前端只给「哈希 + 可读名」类名，皮肤靠子串匹配，很容易踩两个坑：
 *   DEAD  构建换了类名 → 整块样式静默失效（界面上"少了点什么"）；
 *   RISK  命中了同模块的内部变体 → 边框/图标被套两层（界面上"有错误"）。
 * 例：[class*="_newSession"] 会连带命中按钮内部的 newSessionContent，
 *     于是新会话按钮里出现两个半月牙——加 :not([class*="Content"]) 才干净。
 *
 * 用法（Node 即可，无依赖）：
 *   node tools/audit-selectors.mjs ["<DeepSeek Harness 安装目录>"] ["<皮肤 lib 目录>"]
 *
 * 实现：直接解析 Electron 的 app.asar（读目录表，按偏移取文件），收集前端 dist
 * 与全部客户端插件 bundle 里的构建后类名；然后对每条规则的「主体元素」求值：
 * 命中 = 含全部正向 [class*="…"]，且不含任何 :not([class*="…"])。
 * 注意：后代组合器（规则挂在哪棵子树下）静态判断不了，所以只对主体元素求值，
 * 命中集合仍需人工确认是否真的出现在对应子树里。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP = process.argv[2] || path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness')
const SKIN = path.resolve(process.argv[3] || path.join(import.meta.dirname, '..', 'lib'))
const ASAR = path.join(APP, 'resources', 'app.asar')

if (!fs.existsSync(ASAR)) {
  console.error('找不到 app.asar：' + ASAR + '\n请把 DeepSeek Harness 安装目录作为第一个参数传进来。')
  process.exit(1)
}

/* ── 极简 asar 读取（目录表 + 按偏移取文件）─────────────────────────────── */
const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 16)
const base = 16 + headerSize
const root = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/u, ''))

function* entries(node, prefix = '') {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name
    if (val.files) yield* entries(val, p)
    else yield { path: p, size: Number(val.size), offset: val.offset === undefined ? undefined : base + Number(val.offset) }
  }
}
function readText(entry) {
  if (entry.offset === undefined) return null
  const b = Buffer.alloc(entry.size)
  fs.readSync(fd, b, 0, entry.size, entry.offset)
  return b.toString('utf8')
}

/* ── 收集构建后的类名（两种命名：_2H3hWW_x / Dc7zOa_x / Hqq-bq_x）───────── */
const WANTED = [
  /^dsh\/node_modules\/@deepseek-ai\/[^/]+\/lib\/client\.js$/u,
  /^dsh\/node_modules\/@deepseek-ai\/dsh-web-frontend\/dist\/assets\/[^/]+\.(?:js|css)$/u,
]
const names = new Set()
const harvest = (text) => {
  const re = /(?:^|[^A-Za-z0-9_-])(_?[A-Za-z0-9-]{3,12}_[A-Za-z][A-Za-z0-9_]{2,})/gu
  let m
  while ((m = re.exec(text)) !== null) names.add(m[1])
}
let scanned = 0
for (const entry of entries(root)) {
  if (!WANTED.some((r) => r.test(entry.path))) continue
  const text = readText(entry)
  if (text === null) continue
  harvest(text)
  scanned++
}
fs.closeSync(fd)
const all = [...names]
/** 同模块判定用的前缀（哈希段）：_2H3hWW_x / Dc7zOa_x / Hqq-bq_x 都取到第一个下划线。 */
const moduleOf = (cls) => cls.slice(0, cls.indexOf('_') + 1)

console.log('扫描 ' + scanned + ' 个构建产物，收集类名 ' + all.length + ' 个')
console.log('皮肤目录 ' + SKIN + '\n')

/* ── 解析 CSS 规则（去注释，选择器累积到 { 为止）────────────────────────── */
const TOKEN = /:not\(\[class([*^$])="([^"]+)"\]\)|\[class([*^$])="([^"]+)"\]/gu

function rulesOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, '')
  const rules = []
  let buffer = ''
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('@')) { buffer = ''; continue }
    buffer += ' ' + trimmed
    const at = buffer.indexOf('{')
    if (at === -1) continue
    const selectorText = buffer.slice(0, at)
    buffer = ''
    rules.push(selectorText)
  }
  return rules
}

/** 一条选择器列表里，各自的主体元素（最后一个复合选择器）与它的正/负 token。 */
function subjectsOf(selectorText) {
  const out = []
  for (const selector of selectorText.split(',')) {
    const last = selector.trim().split(/\s+/u).pop() || ''
    const positives = []
    const negatives = []
    TOKEN.lastIndex = 0
    let m
    while ((m = TOKEN.exec(last)) !== null) {
      if (m[1] !== undefined) negatives.push(m[2])
      else positives.push(m[4])
    }
    if (positives.length) out.push({ selector: selector.trim(), positives, negatives })
  }
  return out
}

let dead = 0
let risky = 0
let checked = 0
for (const file of ['theme.css', 'pet.css', 'desktop.css']) {
  const full = path.join(SKIN, file)
  if (!fs.existsSync(full)) continue
  const rules = rulesOf(fs.readFileSync(full, 'utf8'))
  const lines = []
  for (const selectorText of rules) {
    for (const subject of subjectsOf(selectorText)) {
      checked++
      const hits = all.filter((cls) => subject.positives.every((t) => cls.includes(t)) && !subject.negatives.some((t) => cls.includes(t)))
      const nested = hits.filter((a) => hits.some((b) => b !== a && b.startsWith(a) && moduleOf(a) === moduleOf(b)))
      let tag = 'ok   '
      if (hits.length === 0) { tag = 'DEAD '; dead++ }
      else if (nested.length) { tag = 'RISK '; risky++ }
      lines.push('  ' + tag + subject.selector.replace(/^html body\s*/u, '').slice(0, 96))
      lines.push('        命中 ' + hits.length + (hits.length && hits.length <= 4 ? '：' + hits.join(', ') : ''))
      if (nested.length) lines.push('        同模块嵌套命中（主体可能被套两层）：' + nested.join(', '))
    }
  }
  if (!lines.length) continue
  console.log('===== ' + file + ' =====')
  console.log(lines.join('\n'))
  console.log('')
}

console.log('共体检 ' + checked + ' 条主体元素规则：DEAD ' + dead + ' 条，RISK ' + risky + ' 条')
if (dead || risky) {
  console.log('提示：DEAD 多是构建改了类名；RISK 表示同一模块里还有同名前缀的类（例如 trigger 与 triggerEffort）。')
  console.log('      带后代组合器的规则（[class*="_composerStack"] …）静态判断不了子树归属，')
  console.log('      请人工确认这些同名类是否真的落在该子树里，再决定要不要再加一个 :not()。')
}
