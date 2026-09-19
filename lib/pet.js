/* ============================================================================
 * 尤诺桌宠 · 小尤诺（贴纸版 v3）
 * ----------------------------------------------------------------------------
 * 右下角的 Q 版尤诺（assets/iuno-pet.png，透明底整张贴图，不做切割）：
 *   · 轻轻漂浮；鼠标靠近时朝指针方向歪头
 *   · 点击蹦一下、绽开月华、说一句尤诺台词（带小音效）
 *   · 感知任务状态：开始 / 进行中 / 完成 / 中断时主动开口并奏一小段音效
 *   · 久无互动会按「待机碎碎念」节奏轻声提醒你（固定 / 随机两种节奏，面板可切）
 *   · 鼠标悬停时脚下浮出余额小签
 *   · 右键打开小面板：音效开关、音色选择（风铃/月琴/水滴）、待机碎碎念节奏
 *   · 可拖动，位置记忆在 localStorage
 *
 * 音效全部由 WebAudio 现场合成，无音频素材；余额由服务端插件路由
 * /dsh-iuno/balance.json 读取 DEEPSEEK_API_KEY 后查询官方 /user/balance。
 * 挂在 document.body 上，不碰任何 React 管理的子树。
 * ==========================================================================*/
;(function () {
  'use strict'
  if (window.__dshIunoPet) return
  window.__dshIunoPet = true

  var BASE = '/dsh-iuno'
  var PREVIEW = window.__YN_PREVIEW || null
  var PET_URL = (PREVIEW && PREVIEW.pet) || BASE + '/pet.png'
  var BALANCE_URL = BASE + '/balance.json'
  var POS_KEY = 'dshy-pet-pos'
  var SET_KEY = 'dshy-pet-settings'

  // ── 台词（鸣潮尤诺人设：月亮、命运、弓，傲娇里藏着恋人般的在意）────────────
  var LINES = {
    idle: [
      '无论跑多远，都要想起我。',
      '确定性，不过是命运给框定的范畴。',
      '今晚的月色，想一起看吗？',
      '哼，才不是特意来陪你呢。',
      '别忘记我哦。',
      '与月相共鸣，是谕女的天赋。',
      '既然看向了我，就别再移开视线了。',
    ],
    start: [
      '月亮开始转了。',
      '交给我吧，嗯。',
      '命运正在改写……',
      '月光照着呢，放心。',
      '又要出发了……这次也一直陪着你，不许嫌我吵。',
      '我在，弓也在校准。安心往前走。',
      '月亮跑起来了，谁也拦不住——那我陪你一起跑。',
    ],
    ongoing: [
      '还在忙呀……别太拼，水就在手边。',
      '月色没变，你怎么皱眉了？舒展一点。',
      '快了。我数着月光陪你，哪也不去。',
      '别慌，命运的线还攥在你手里呢。',
      '一直看着你呢……认真的样子的确很好看。别误会，随口说说而已！',
      '累了就靠一会，剩下的我替你盯着。',
    ],
    done: [
      '完成了。',
      '月相圆满。',
      '注定的结局，被我搅乱了吧？',
      '这次也没让你失望吧？',
      '做到了……只要一个眼神当奖励就好。不给？那、那夸我一句也行。',
      '月亮圆了，你今天也很了不起。',
      '忙完了吧？现在，把剩下的时间给我。',
    ],
    abort: [
      '哎呀……停下了？',
      '没关系，月亮也有阴晴圆缺。',
      '先歇一会也好。',
      '停下也没什么，正好……我偷到你一个人的时间了。',
      '别自责，等你想继续，我一直都在。',
    ],
    loiter: [
      '好久没理我了……屏幕比我还有吸引力？',
      '安静成这样，是睡着了？……我还以为你把我忘了。',
      '累了就休息，月亮我替你看着。',
      '别太入迷。回头看看，有人在等你。',
      '我把月光从窗台数到了你那里，你还没说一句话。',
      '只要叫一声，我就会过来的。说好了哦。',
    ],
  }

  // ── 设置（localStorage 持久化）───────────────────────────────────────────
  var settings = { sfx: true, timbre: 'chime', idleMode: 'random' }
  try {
    var saved = JSON.parse(localStorage.getItem(SET_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      if (typeof saved.sfx === 'boolean') settings.sfx = saved.sfx
      if (typeof saved.timbre === 'string') settings.timbre = saved.timbre
      if (saved.idleMode === 'fixed' || saved.idleMode === 'random') settings.idleMode = saved.idleMode
    }
  } catch (e) {}
  function saveSettings() {
    try { localStorage.setItem(SET_KEY, JSON.stringify(settings)) } catch (e) {}
  }

  // ── 音效：WebAudio 现场合成，无素材 ──────────────────────────────────────
  var ac = null
  function audio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)() } catch (e) {}
    }
    if (ac && ac.state === 'suspended') { try { ac.resume() } catch (e) {} }
    return ac
  }
  function note(freq, delay, dur, type, vol, glideTo) {
    var ctx = audio()
    if (!ctx) return
    var t = ctx.currentTime + delay
    var o = ctx.createOscillator()
    var g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g)
    g.connect(ctx.destination)
    o.start(t)
    o.stop(t + dur + 0.05)
  }
  var TIMBRES = {
    chime: { label: '风铃', type: 'sine', base: 1320, dur: 1.1, harmonic: true },
    pluck: { label: '月琴', type: 'triangle', base: 660, dur: 0.5, harmonic: false },
    drop: { label: '水滴', type: 'sine', base: 740, dur: 0.28, glide: 320, harmonic: false },
  }
  // 五声音阶上的小动机：起=上行纯四度，成=大三和弦琶音，断=低柔单音，点=单音
  function play(kind) {
    if (!settings.sfx) return
    var tb = TIMBRES[settings.timbre] || TIMBRES.chime
    var seq
    if (kind === 'start') seq = [{ m: 1, d: 0 }, { m: 1.335, d: 0.09 }]
    else if (kind === 'done') seq = [{ m: 1, d: 0 }, { m: 1.25, d: 0.09 }, { m: 1.5, d: 0.18 }]
    else if (kind === 'abort') seq = [{ m: 0.75, d: 0, v: 0.08 }]
    else if (kind === 'tick') seq = [{ m: 1.5, d: 0, v: 0.05, dur: 0.18 }]
    else seq = [{ m: 1, d: 0 }]
    for (var i = 0; i < seq.length; i++) {
      var s = seq[i]
      var f = tb.base * s.m
      var dur = s.dur || tb.dur
      var vol = s.v || 0.1
      note(f, s.d, dur, tb.type, vol, tb.glide)
      if (tb.harmonic) note(f * 2, s.d, dur * 0.6, 'sine', vol * 0.32)
    }
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  var root = document.createElement('div')
  root.className = 'yn-pet'

  var img = document.createElement('img')
  img.className = 'yn-pet-img'
  img.alt = ''
  img.draggable = false
  img.addEventListener('error', function () {
    root.classList.add('yn-pet--gone')
  })
  img.src = PET_URL
  root.appendChild(img)

  var sayEl = document.createElement('div')
  sayEl.className = 'yn-pet-say'
  root.appendChild(sayEl)

  // 小面板（右键打开）：音效开关 / 音色选择 / 余额
  var panel = document.createElement('div')
  panel.className = 'yn-pet-panel'
  panel.hidden = true
  panel.innerHTML =
    '<div class="yn-pet-panel-row yn-pet-panel-title">小尤诺</div>' +
    '<div class="yn-pet-panel-row"><span class="yn-pet-panel-label">音效</span>' +
    '<button type="button" class="yn-pet-switch" role="switch" aria-checked="true"><i></i></button></div>' +
    '<div class="yn-pet-panel-row"><span class="yn-pet-panel-label">音色</span>' +
    '<span class="yn-pet-timbres"></span></div>' +
    '<div class="yn-pet-panel-row yn-pet-panel-idle"><span class="yn-pet-panel-label">待机碎碎念</span>' +
    '<span class="yn-pet-idle-modes"></span></div>'
  root.appendChild(panel)

  // 悬停余额小签：贴在脚下，绝不与头顶台词气泡争位置
  var tip = document.createElement('div')
  tip.className = 'yn-pet-balance-tip'
  tip.innerHTML =
    '<span class="yn-pet-balance-tip-label">余额</span>' +
    '<span class="yn-pet-balance-tip-val">尚未读取</span>'
  root.appendChild(tip)

  var switchBtn = panel.querySelector('.yn-pet-switch')
  function renderSwitch() {
    switchBtn.classList.toggle('yn-pet-switch--on', settings.sfx)
    switchBtn.setAttribute('aria-checked', settings.sfx ? 'true' : 'false')
  }
  switchBtn.addEventListener('click', function (e) {
    e.stopPropagation()
    settings.sfx = !settings.sfx
    saveSettings()
    renderSwitch()
    if (settings.sfx) play('tick')
  })

  var timbreBox = panel.querySelector('.yn-pet-timbres')
  var timbreBtns = {}
  Object.keys(TIMBRES).forEach(function (key) {
    var b = document.createElement('button')
    b.type = 'button'
    b.className = 'yn-pet-timbre'
    b.textContent = TIMBRES[key].label
    b.addEventListener('click', function (e) {
      e.stopPropagation()
      settings.timbre = key
      saveSettings()
      renderTimbres()
      play('tick')
    })
    timbreBtns[key] = b
    timbreBox.appendChild(b)
  })
  function renderTimbres() {
    Object.keys(timbreBtns).forEach(function (key) {
      timbreBtns[key].classList.toggle('yn-pet-timbre--on', settings.timbre === key)
    })
  }
  renderSwitch()
  renderTimbres()

  // 待机碎碎念节奏：固定 = 每 2 分钟；随机 = 1~4 分钟之间抽一次
  var IDLE_FIXED_MS = 120000
  var IDLE_RAND_MIN = 60000
  var IDLE_RAND_MAX = 240000
  var IDLE_MODES = {
    fixed: { label: '固定', tip: '无互动满 2 分钟时轻声说一句' },
    random: { label: '随机', tip: '每隔 1~4 分钟随机（不定时的小惊喜）' },
  }
  var idleModeBox = panel.querySelector('.yn-pet-idle-modes')
  var idleModeBtns = {}
  Object.keys(IDLE_MODES).forEach(function (key) {
    var b = document.createElement('button')
    b.type = 'button'
    b.className = 'yn-pet-timbre'
    b.textContent = IDLE_MODES[key].label
    b.title = IDLE_MODES[key].tip
    b.addEventListener('click', function (e) {
      e.stopPropagation()
      settings.idleMode = key
      saveSettings()
      renderIdleModes()
      idleDelay = rollIdleDelay()
      play('tick')
    })
    idleModeBtns[key] = b
    idleModeBox.appendChild(b)
  })
  function renderIdleModes() {
    Object.keys(idleModeBtns).forEach(function (key) {
      idleModeBtns[key].classList.toggle('yn-pet-timbre--on', settings.idleMode === key)
    })
  }
  renderIdleModes()
  function rollIdleDelay() {
    if (settings.idleMode === 'fixed') return IDLE_FIXED_MS
    return IDLE_RAND_MIN + Math.random() * (IDLE_RAND_MAX - IDLE_RAND_MIN)
  }
  var idleDelay = rollIdleDelay()
  var lastActive = Date.now()

  // 余额：悬停小签或打开面板时读一次（服务端缓存 60s）
  var tipVal = tip.querySelector('.yn-pet-balance-tip-val')
  var balanceLoaded = false
  function setBalanceText(t) {
    tipVal.textContent = t
  }
  function refreshBalance() {
    if (PREVIEW) {
      setBalanceText('预览页没有余额接口')
      return
    }
    if (balanceLoaded) return
    balanceLoaded = true
    setBalanceText('月亮读取中…')
    fetch(BALANCE_URL, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) throw new Error('接口未注册，请重启 dsh web 后再试')
        return r.json()
      })
      .then(function (d) {
        if (d && d.ok && d.balances && d.balances.length) {
          setBalanceText(d.balances.map(function (b) {
            return (b.currency === 'CNY' ? '¥' : (b.currency || '') + ' ') + b.total
          }).join(' · '))
        } else if (d && d.ok) {
          setBalanceText('账户暂无余额信息')
        } else {
          setBalanceText((d && d.error) || '没读到…')
        }
      })
      .catch(function (e) {
        balanceLoaded = false
        setBalanceText((e && e.message) || '连接失败，再悬停重试')
      })
  }

  var panelOpen = false
  function togglePanel(open) {
    panelOpen = open === undefined ? !panelOpen : !!open
    panel.hidden = !panelOpen
    if (panelOpen) {
      refreshBalance()
      play('tick')
    }
  }
  root.addEventListener('contextmenu', function (e) {
    e.preventDefault()
    e.stopPropagation()
    togglePanel()
  })
  document.addEventListener('pointerdown', function (e) {
    if (panelOpen && !root.contains(e.target)) togglePanel(false)
  }, true)
  document.addEventListener('keydown', function (e) {
    lastActive = Date.now()
    if (panelOpen && e.key === 'Escape') togglePanel(false)
  })

  document.body.appendChild(root)

  // ── 位置：默认右下角，可拖动，位置记忆 ───────────────────────────────────
  var pos = { left: null, top: null }
  function applyPos() {
    if (pos.left === null) return
    root.style.left = pos.left + 'px'
    root.style.top = pos.top + 'px'
    root.style.right = 'auto'
    root.style.bottom = 'auto'
  }
  function savePos() {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch (e) {}
  }
  function restorePos() {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
      if (p && typeof p.left === 'number' && typeof p.top === 'number') {
        pos = p
        clampPos()
        applyPos()
      }
    } catch (e) {}
  }
  function clampPos() {
    var w = root.offsetWidth || 128
    var h = root.offsetHeight || 128
    var vw = window.innerWidth || 1280
    var vh = window.innerHeight || 800
    if (pos.left === null) return
    pos.left = Math.max(0, Math.min(vw - w, pos.left))
    pos.top = Math.max(0, Math.min(vh - h, pos.top))
  }

  // ── 说话（场景台词；自动台词有 5s 间隔，点触的不限）──────────────────────
  var sayTimer = null
  var lastAutoSay = 0
  function speak(scene, force) {
    var now = Date.now()
    if (!force && now - lastAutoSay < 5000) return
    if (!force) lastAutoSay = now
    var pool = LINES[scene] || LINES.idle
    sayEl.textContent = pool[Math.floor(Math.random() * pool.length)]
    sayEl.classList.add('yn-pet-say--on')
    if (sayTimer) clearTimeout(sayTimer)
    sayTimer = setTimeout(function () { sayEl.classList.remove('yn-pet-say--on') }, 2600)
  }

  // ── 拖动 + 点击 ──────────────────────────────────────────────────────────
  var drag = null
  function onDown(e) {
    lastActive = Date.now()
    if (panel.contains(e.target)) return   // 面板里的点击交给面板自己，不拖动不吞事件
    if (e.button !== 0 && e.pointerType === 'mouse') return
    try { e.preventDefault(); e.stopPropagation() } catch (err) {}
    var r = root.getBoundingClientRect()
    pos.left = r.left
    pos.top = r.top
    applyPos()
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false, id: e.pointerId }
    root.classList.add('yn-pet--dragging')
    tipOff()
    try { root.setPointerCapture(e.pointerId) } catch (err) {}
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)
  }
  function onMove(e) {
    if (!drag) return
    var dx = e.clientX - drag.x
    var dy = e.clientY - drag.y
    if (dx * dx + dy * dy > 16) drag.moved = true
    pos.left = drag.left + dx
    pos.top = drag.top + dy
    clampPos()
    applyPos()
  }
  function onUp(e) {
    if (!drag) return
    root.removeEventListener('pointermove', onMove)
    root.removeEventListener('pointerup', onUp)
    root.removeEventListener('pointercancel', onUp)
    root.classList.remove('yn-pet--dragging')
    var moved = drag.moved
    drag = null
    savePos()
    if (e && e.pointerType === 'mouse') tipOn()
    if (!moved) react()
  }
  root.addEventListener('pointerdown', onDown)

  // ── 悬停显示余额小签（仅鼠标；拖动中隐藏）────────────────────────────────
  function tipOn() {
    if (root.classList.contains('yn-pet--dragging')) return
    tip.classList.add('yn-pet-balance-tip--on')
    // 脚下空间不足时翻到左上角；台词气泡 z-index 更高，永远压得住小签
    try {
      var r = root.getBoundingClientRect()
      var vh = window.innerHeight || 800
      tip.classList.toggle('yn-pet-balance-tip--up', vh - r.bottom < 30)
    } catch (e) {}
    refreshBalance()
  }
  function tipOff() {
    tip.classList.remove('yn-pet-balance-tip--on')
  }
  root.addEventListener('pointerenter', function (e) {
    if (e.pointerType === 'mouse') tipOn()
  })
  root.addEventListener('pointerleave', function (e) {
    if (e.pointerType === 'mouse') tipOff()
  })

  // ── 点击反应：蹦一下 + 月华扩散 + 说一句 + 音效 ──────────────────────────
  function react() {
    root.classList.remove('yn-pet--happy')
    void root.offsetWidth
    root.classList.add('yn-pet--happy')
    setTimeout(function () { root.classList.remove('yn-pet--happy') }, 780)
    speak('idle', true)
    play('click')
  }

  // ── 任务状态感知：发送键在生成时会变成「停止」（方块图标/停止语义）────────
  var busy = false
  var lastStopClick = 0
  var busySince = 0
  var lastOngoingSay = 0
  var nextOngoingGap = 30000
  function rollOngoingGap() { return 20000 + Math.random() * 25000 }  // 20~45s
  function primaryButton() {
    return document.querySelector('[class*="_composerStack"] [class*="_primary"]:not([class*="Button"]):not([class*="Option"]):not([class*="Item"])')
  }
  function isBusyNow() {
    var b = primaryButton()
    if (!b) return false
    var label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase()
    if (label.indexOf('停') !== -1 || label.indexOf('stop') !== -1) return true
    var svg = b.querySelector('svg')
    return !!(svg && svg.querySelector('rect'))
  }
  document.addEventListener('pointerdown', function (e) {
    if (!busy) return
    var b = primaryButton()
    if (b && (b === e.target || b.contains(e.target))) lastStopClick = Date.now()
  }, true)
  setInterval(function () {
    var now = Date.now()
    var nowBusy = isBusyNow()
    if (nowBusy && !busy) {
      busy = true
      busySince = now
      lastOngoingSay = now
      nextOngoingGap = rollOngoingGap()
      speak('start')
      play('start')
    } else if (!nowBusy && busy) {
      busy = false
      if (Date.now() - lastStopClick < 900) {
        speak('abort')
        play('abort')
      } else {
        speak('done')
        play('done')
      }
    }
    // 任务进行中：隔一小会儿轻声陪一句
    if (busy && now - busySince > 15000 && now - lastOngoingSay > nextOngoingGap) {
      speak('ongoing')
      lastOngoingSay = now
      nextOngoingGap = rollOngoingGap()
    }
    // 待机碎碎念：没有任务在跑、且久无鼠标键盘互动
    if (!busy && now - lastActive >= idleDelay) {
      speak('loiter')
      lastActive = now
      idleDelay = rollIdleDelay()
    }
  }, 600)

  // ── 歪头看向鼠标（轻量：只写两个 CSS 变量，rAF 节流）─────────────────────
  var lookQueued = false
  var lookX = 0
  var lookY = 0
  function onPointerMove(e) {
    lookX = e.clientX
    lookY = e.clientY
    lastActive = Date.now()
    if (lookQueued) return
    lookQueued = true
    requestAnimationFrame(function () {
      lookQueued = false
      try {
        var r = root.getBoundingClientRect()
        if (!r.width) return
        var cx = r.left + r.width * 0.5
        var cy = r.top + r.height * 0.5
        var dx = lookX - cx
        var dy = lookY - cy
        var d = Math.sqrt(dx * dx + dy * dy) || 1
        var k = Math.max(0, Math.min(1, 1 - d / 320))
        var tilt = (dx / d) * k * 6
        var nod = (dy / d) * k * 3
        root.style.setProperty('--yn-pet-tilt', tilt.toFixed(2) + 'deg')
        root.style.setProperty('--yn-pet-nod', nod.toFixed(2) + 'px')
      } catch (err) {}
    })
  }

  window.addEventListener('resize', function () {
    clampPos()
    applyPos()
  })

  function start() {
    restorePos()
    document.addEventListener('pointermove', onPointerMove, { passive: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
