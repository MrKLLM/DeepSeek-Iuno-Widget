/* ============================================================================
 * 尤诺主题 · 极简注入（v5）
 * ----------------------------------------------------------------------------
 * 只做两件事：铺壁纸 + 铺氛围层（星尘）。
 *
 * v5 修复：移除「品牌月环徽记」注入。此前 ensureSigil() 会往 React 管理的
 * 品牌按钮里 insertBefore 外来节点，并用 MutationObserver 反复补插——
 * React 重渲染（收起/展开侧栏）时与外来节点冲突：
 *   1. 徽记被重复注入，收起后左上角出现两个无意义月牙图标；
 *   2. React reconcile 抛 NotFoundError，收起态的「展开侧栏」按钮点击失效。
 * 现在装饰全部走纯 CSS，不再触碰任何 React 管理的 DOM。
 * ==========================================================================*/
;(function () {
  'use strict'
  if (window.__dshIunoSkin) return
  window.__dshIunoSkin = true

  var BASE = '/dsh-iuno'
  var PREVIEW = window.__YN_PREVIEW || null
  var WALL_URL = (PREVIEW && PREVIEW.wall) || BASE + '/wall.jpg'
  var AMBIENCE_KEY = '--yn-ambience'

  function buildWall() {
    if (document.querySelector('.yn-skin-wall')) return
    var wall = document.createElement('div')
    wall.className = 'yn-skin-wall'
    wall.setAttribute('aria-hidden', 'true')
    wall.style.backgroundImage = 'url("' + WALL_URL + '")'
    document.body.appendChild(wall)
  }

  function buildVeil() {
    if (document.querySelector('.yn-skin-veil')) return
    var veil = document.createElement('div')
    veil.className = 'yn-skin-veil'
    veil.setAttribute('aria-hidden', 'true')
    var stars = document.createElement('div')
    stars.className = 'yn-skin-stars'
    veil.appendChild(stars)
    document.body.appendChild(veil)
  }

  function setAmbience(v) {
    var n = Number(v)
    if (!isFinite(n)) n = 1
    n = Math.max(0, Math.min(1, n))
    document.documentElement.style.setProperty(AMBIENCE_KEY, String(n))
    var veil = document.querySelector('.yn-skin-veil')
    if (veil) veil.toggleAttribute('hidden', n <= 0.01)
  }
  window.__ynSetAmbience = setAmbience
  window.addEventListener('yn:ambience', function (e) {
    setAmbience(e && e.detail !== undefined ? e.detail : 1)
  })

  function start() {
    buildWall()
    buildVeil()
    try {
      fetch(BASE + '/size.json', { cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (d) {
          if (d && typeof d.ambience === 'number') setAmbience(d.ambience)
        })
        .catch(function () {})
    } catch (err) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
