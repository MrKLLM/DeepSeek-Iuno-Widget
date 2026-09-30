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
 * /dsh-iuno/balance.json 提供：登录了 DeepSeek 账号就优先读账号钱包，
 * 否则回退 DEEPSEEK_API_KEY + 官方 /user/balance。
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

  // ── 台词（依游戏语音表重写：谕女 · 月亮 · 命运；高傲、任性、命令式的亲昵）──
  //   ★ = 游戏原句或原句节选。她的"傲娇"不是撒娇，是「勉为其难」「不准」「取悦我吧」
  //   加一句「哦 / 呢 / 啦 / 吧」；称呼漂泊者时偶尔用原句里的 Darling。
  var LINES = {
    idle: [
      '以何圆满？——问你呢。', // ★ 原句节选
      '我，即是月亮。', // ★ 原句节选
      '不许将就。要就要最好的。',
      '命运不肯给你的，我陪你抢过来。',
      '过来，让我看看你在想什么。',
      '今晚的月亮归我，你归我管——有意见？',
      '偶尔也抬头看看月亮吧，我不介意你顺便看我。',
      '别急着崇拜我，先好好看着。',
    ],
    start: [
      '可以啊，让我来给予你启示。', // ★ 原句节选
      '许愿吧——我替你把结局往好的那边推一推。',
      '我来给你开路。跟着我，别走丢哦。',
      '开始吧，这一局我替你占过了。',
      '要动手就快点，我看着呢。',
      '让我看看你能走到哪一步——别让我失望。',
      '月亮升起来了。走吧，我陪你。',
    ],
    ongoing: [
      '专心一点。分神的话，我替你盯着。',
      '不许逞强。累了就往我这边靠，勉为其难借你一会儿。',
      '还没好？……慢慢来，我又没催你。',
      '做不完也没关系。我允许你慢一点。',
      '要我夸你两句才有力气？……先做完再说。',
      '你做事的样子……还算能看。继续。',
    ],
    done: [
      '做完了。奖励呢？我要的，不许赖。',
      '没我不行吧？', // ★ 原句节选
      '很好。过来，让我看看你今天有多得意。',
      '取悦我吧。就现在。', // ★ 原句节选
      '完成了。这一次，也算你配得上我的注视。',
      '结果不错。不过别太得意，我还没夸够呢。',
      '做得漂亮。……哼，我可不是随便夸人的。',
    ],
    abort: [
      '停就停吧。命运也常有打盹的时候。',
      '你总算肯歇了。……也好，我正好有句话没说。',
      '不做了？那就陪我看会儿月亮，反正你也没别的事。',
      '别摆出那副表情。我又没说你不行。',
      '中断而已。重整旗鼓的时候，记得叫我。',
    ],
    loiter: [
      '别忘了我。这不是请求，是命令哦。',
      '才一会儿工夫，就把我晾在这儿了？',
      '你该不会，真的把我忘了吧？',
      'Darling，抬头看看我。', // ★ 原句节选
      '我数着月亮等你。数到第几个你才肯说话？',
      '只要你叫一声，我就过来了——勉为其难地过来。',
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

  // 小面板（右键打开）：音效开关 / 音色选择 / 待机碎碎念 / 壁纸亮度 / 更换背景
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
    '<span class="yn-pet-idle-modes"></span></div>' +
    '<div class="yn-pet-panel-row yn-pet-panel-wall-bright"><span class="yn-pet-panel-label">壁纸亮度</span>' +
    '<span class="yn-pet-wall-bright-wrap"><input type="range" min="0.4" max="1" step="0.01" class="yn-pet-slider"><em class="yn-pet-slider-val">86%</em></span></div>' +
    '<div class="yn-pet-panel-row"><span class="yn-pet-panel-label">背景</span>' +
    '<span class="yn-pet-wall-btns"><button type="button" class="yn-pet-wall-btn yn-pet-wall-choose">更换</button>' +
    '<button type="button" class="yn-pet-wall-btn yn-pet-wall-reset">默认</button></span></div>' +
    '<input type="file" accept="image/*" class="yn-pet-wall-file" hidden>'
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

  // ── 壁纸亮度 + 更换背景（写服务端 size.json / wall.jpg）──────────────────
  var WALL_BRIGHT_DEFAULT = 0.86
  var slider = panel.querySelector('.yn-pet-slider')
  var sliderVal = panel.querySelector('.yn-pet-slider-val')
  var wallChooseBtn = panel.querySelector('.yn-pet-wall-choose')
  var wallResetBtn = panel.querySelector('.yn-pet-wall-reset')
  var wallFile = panel.querySelector('.yn-pet-wall-file')

  function readWallBrightness() {
    try {
      var raw = getComputedStyle(document.documentElement).getPropertyValue('--yn-wall-brightness')
      var n = parseFloat(raw)
      if (isFinite(n) && n > 0) return Math.max(0.4, Math.min(1, n))
    } catch (e) {}
    return WALL_BRIGHT_DEFAULT
  }
  function paintSlider() {
    var v = readWallBrightness()
    slider.value = String(v)
    sliderVal.textContent = Math.round(v * 100) + '%'
  }
  paintSlider()

  var saveTimer = null
  slider.addEventListener('input', function () {
    var v = parseFloat(slider.value)
    sliderVal.textContent = Math.round(v * 100) + '%'
    if (window.__ynSetWallBrightness) window.__ynSetWallBrightness(v)
    else document.documentElement.style.setProperty('--yn-wall-brightness', String(v))
    clearTimeout(saveTimer)
    saveTimer = setTimeout(function () {
      fetch(BASE + '/size.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallBrightness: v }),
      }).catch(function () {})
    }, 250)
  })

  function refreshWall() {
    if (window.__ynReloadWall) window.__ynReloadWall()
  }

  wallChooseBtn.addEventListener('click', function (e) {
    e.stopPropagation()
    wallFile.click()
  })
  wallFile.addEventListener('change', function () {
    var f = wallFile.files && wallFile.files[0]
    if (!f) return
    if (f.size > 20 * 1024 * 1024) { speak('abort'); return }
    wallChooseBtn.textContent = '…'
    fetch(BASE + '/wall.jpg', { method: 'POST', headers: { 'Content-Type': f.type || 'image/jpeg' }, body: f })
      .then(function (r) { return r.json() })
      .then(function (d) {
        wallChooseBtn.textContent = d && d.ok ? '已换' : '失败'
        refreshWall()
        play('done')
        setTimeout(function () { wallChooseBtn.textContent = '更换' }, 1600)
      })
      .catch(function () {
        wallChooseBtn.textContent = '失败'
        setTimeout(function () { wallChooseBtn.textContent = '更换' }, 1600)
      })
    wallFile.value = ''
  })

  wallResetBtn.addEventListener('click', function (e) {
    e.stopPropagation()
    fetch(BASE + '/wall.jpg?reset=1', { method: 'POST' })
      .then(function (r) { return r.json() })
      .then(function () {
        refreshWall()
        play('tick')
      })
      .catch(function () {})
  })

  // ── 余额：悬停小签 / 打开面板时刷新 ─────────────────────────────────────
  //  客户端 20s 节流；每次都带 ?force=1 绕过宿主 60s 缓存 ——
  //  否则页面加载后余额就"定格"在第一次读到的数字上（旧版正是这个毛病）。
  var tipVal = tip.querySelector('.yn-pet-balance-tip-val')
  var balanceAt = 0
  var balanceBusy = false
  var balanceHasValue = false
  function setBalanceText(t) {
    tipVal.textContent = t
  }
  function money(v, currency) {
    var n = Number(v)
    var sym = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : (currency ? currency + ' ' : '')
    if (!isFinite(n)) return sym + String(v === undefined || v === null ? '—' : v)
    // 半分向上取整（+1e-9 避开 1.005 → 1.00 的浮点坑），再补千分位
    var s = (Math.round(n * 100 + 1e-9) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return sym + s
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
    })
  }
  /* 一行一个币种：主数字 = 可用余额（充值 + 赠送），赠送部分缩一级灰蓝缀在后面。
     平台返回的金额是带长尾数的十进制字符串，统一四舍五入到分再显示。 */
  function walletCell(b) {
    var out = '<span class="yn-pet-balance-tip-main">' + esc(money(b && b.total, b && b.currency)) + '</span>'
    var bonus = Number(b && b.granted)
    var normal = Number(b && b.toppedUp)
    if (isFinite(bonus) && bonus >= 0.005) {
      var note = isFinite(normal) && normal >= 0.005 ? '赠送 ' + money(bonus, b.currency) : '全额赠送'
      out += '<span class="yn-pet-balance-tip-bonus">' + esc(note) + '</span>'
    }
    return out
  }
  function refreshBalance(force) {
    if (PREVIEW) {
      setBalanceText('预览页没有余额接口')
      return
    }
    if (balanceBusy) return
    if (!force && Date.now() - balanceAt < 20000) return
    balanceBusy = true
    if (!balanceHasValue) setBalanceText('月亮读取中…')
    fetch(BALANCE_URL + '?force=1&t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) throw new Error('接口未注册，请重启 dsh web 后再试')
        return r.json()
      })
      .then(function (d) {
        if (d && d.ok && d.balances && d.balances.length) {
          balanceHasValue = true
          tipVal.innerHTML = d.balances.map(walletCell)
            .join('<span class="yn-pet-balance-tip-sep">·</span>')
        } else if (d && d.ok) {
          balanceHasValue = true
          setBalanceText('账户暂无余额信息')
        } else {
          setBalanceText((d && d.error) || '没读到…')
        }
      })
      .catch(function (e) {
        setBalanceText((e && e.message) || '连接失败，再悬停重试')
      })
      .then(function () {
        balanceAt = Date.now()
        balanceBusy = false
      })
  }

  var panelOpen = false
  function togglePanel(open) {
    panelOpen = open === undefined ? !panelOpen : !!open
    panel.hidden = !panelOpen
    if (panelOpen) {
      paintSlider()
      refreshBalance(true)   // 主动打开面板 = 强制刷新
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
