/* ============================================================================
 * 尤诺主题 · 鼠标流光（尤诺蓝 · 彗星丝带）
 * ----------------------------------------------------------------------------
 * 一颗小小的月光彗头拖着丝带：指针轨迹先经过一个带惯性的虚拟光标
 * （每帧向其缓动），丝带于是像绸缎一样平滑地"拖"在指针后面；
 * 彗头一团柔光，偶尔溅出一两颗星屑。全部蓝色系：夜蓝外晕、月白内芯。
 * 画布 pointer-events:none，只发光不挡点击；尊重 prefers-reduced-motion
 * 与氛围浓度（yn:ambience 事件）。
 * ==========================================================================*/
;(function () {
  'use strict'
  if (window.__dshIunoTrail) return
  window.__dshIunoTrail = true

  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  } catch (e) {}

  var LIFETIME = 520        // 丝带存续毫秒
  var MAX_POINTS = 110
  var EASE = 0.38           // 虚拟光标惯性：越小尾巴越"绸"
  var strength = 1

  var cv = document.createElement('canvas')
  cv.className = 'yn-trail'
  cv.setAttribute('aria-hidden', 'true')
  var ctx = cv.getContext('2d')

  var dpr = Math.min(2, window.devicePixelRatio || 1)
  function resize() {
    cv.width = Math.floor(window.innerWidth * dpr)
    cv.height = Math.floor(window.innerHeight * dpr)
  }
  resize()
  window.addEventListener('resize', resize)

  // 预渲染彗头柔光（蓝）与星屑（白蓝）
  function makeGlow(inner, outer) {
    var c = document.createElement('canvas')
    c.width = 48
    c.height = 48
    var g = c.getContext('2d')
    var grad = g.createRadialGradient(24, 24, 0, 24, 24, 24)
    grad.addColorStop(0, inner)
    grad.addColorStop(0.4, outer)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 48, 48)
    return c
  }
  var HEAD_GLOW = makeGlow('rgba(214,232,255,0.95)', 'rgba(122,166,245,0.35)')
  var SPARK = makeGlow('rgba(255,255,255,0.95)', 'rgba(157,192,255,0.4)')

  var pts = []              // 丝带点 {x, y, t}
  var sparks = []           // 星屑 {x, y, vx, vy, t, size}
  var mouse = { x: -1, y: -1 }
  var head = { x: -1, y: -1 }
  var running = false

  function onMove(e) {
    mouse.x = e.clientX
    mouse.y = e.clientY
    if (head.x < 0) { head.x = mouse.x; head.y = mouse.y }
    kick()
  }

  function frame(now) {
    // 虚拟光标向真实指针缓动 → 丝带自然弯曲、不断裂
    var dx = mouse.x - head.x
    var dy = mouse.y - head.y
    var dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > 0.4) {
      head.x += dx * EASE
      head.y += dy * EASE
      pts.push({ x: head.x, y: head.y, t: now })
      if (pts.length > MAX_POINTS) pts.splice(0, pts.length - MAX_POINTS)
      // 速度越快越容易溅出星屑
      if (dist > 14 && sparks.length < 18 && Math.random() < 0.3) {
        var ang = Math.random() * Math.PI * 2
        sparks.push({
          x: head.x, y: head.y,
          vx: Math.cos(ang) * 0.35, vy: Math.sin(ang) * 0.35 - 0.15,
          t: now, size: 2.5 + Math.random() * 3.5,
        })
      }
    }
    while (pts.length && now - pts[0].t > LIFETIME) pts.shift()

    ctx.clearRect(0, 0, cv.width, cv.height)
    var n = pts.length

    // ── 丝带：逐段描边，三层叠加（外晕/中间/内芯），宽度随新旧渐变 ──
    if (n > 2) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (var i = 1; i < n; i++) {
        var p0 = pts[i - 1]
        var p1 = pts[i]
        var age = 1 - (now - p1.t) / LIFETIME   // 1=彗头 0=将逝
        var pos = i / n                          // 沿丝带 0=尾 1=头
        var w = Math.max(0.1, (0.6 + 5.2 * pos * pos) * age) * dpr
        var a = age * strength
        // 外晕：夜蓝
        ctx.strokeStyle = 'rgba(70,112,214,1)'
        ctx.globalAlpha = 0.08 * a
        ctx.lineWidth = w * 4.2
        line(p0, p1)
        // 中间：月蓝
        ctx.strokeStyle = 'rgba(122,166,245,1)'
        ctx.globalAlpha = 0.20 * a
        ctx.lineWidth = w * 2.0
        line(p0, p1)
        // 内芯：月白
        ctx.strokeStyle = 'rgba(224,238,255,1)'
        ctx.globalAlpha = 0.5 * a
        ctx.lineWidth = w
        line(p0, p1)
      }
    }

    // ── 彗头柔光（随速度大小微微涨缩）──
    if (head.x >= 0 && (n > 1 || dist > 0.4)) {
      var hs = (20 + Math.min(14, dist * 0.35)) * dpr
      ctx.globalAlpha = 0.75 * strength
      ctx.drawImage(HEAD_GLOW, head.x * dpr - hs / 2, head.y * dpr - hs / 2, hs, hs)
    }

    // ── 星屑：飘一下，灭掉 ──
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i]
      var sage = (now - s.t) / 600
      if (sage >= 1) { sparks.splice(i, 1); continue }
      s.x += s.vx
      s.y += s.vy
      var ss = s.size * (1 - sage) * dpr * 3
      ctx.globalAlpha = (1 - sage) * 0.8 * strength
      ctx.drawImage(SPARK, s.x * dpr - ss / 2, s.y * dpr - ss / 2, ss, ss)
    }

    ctx.globalAlpha = 1
    if (n > 1 || sparks.length || dist > 0.4) {
      requestAnimationFrame(frame)
    } else {
      running = false
      ctx.clearRect(0, 0, cv.width, cv.height)
    }
  }
  function line(p0, p1) {
    ctx.beginPath()
    ctx.moveTo(p0.x * dpr, p0.y * dpr)
    ctx.lineTo(p1.x * dpr, p1.y * dpr)
    ctx.stroke()
  }
  function kick() {
    if (!running) {
      running = true
      requestAnimationFrame(frame)
    }
  }

  function start() {
    document.body.appendChild(cv)
    document.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('yn:ambience', function (e) {
      var v = Number(e && e.detail)
      strength = isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
      if (strength <= 0.01) { pts.length = 0; sparks.length = 0 }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
