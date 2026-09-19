"""Build skin-preview.html — an offline replica of the DSH shell for verifying the
Iuno skin without a running DSH server.

It loads the REAL component stylesheets extracted from the installed
`@deepseek-ai/dsh-client-ui-*` packages, rebuilds the shell DOM with the REAL
CSS-module class names (every one verified to exist in those stylesheets), and
then applies this repo's `lib/theme.css` + `lib/theme.js` on top. That makes the
preview a genuine test of the skin's selectors and token overrides.

Because DSH's real DOM nesting is React-internal, the replica is a best-effort
shell; the skin is token-first by design, so the result tracks the real UI.

Run:  python tools/build_skin_preview.py
Out:  skin-preview.html  (self-contained)
"""
import os
import re
import sys
import json

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CSS_DIR = os.path.join(ROOT, 'tools', '_dshcss')
DSH = r"C:\Users\KLLM\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai"
FAVICON = os.path.join(DSH, 'dsh-web-frontend', 'dist', 'favicon.svg')

SHEETS = [
    'dsh-client-ui-theme',
    'dsh-client-ui-layout',
    'dsh-client-ui-sidebar',
    'dsh-client-ui-workspace',
    'dsh-client-ui-conversation',
    'dsh-client-ui-chat',
    'dsh-client-ui-model-selection',
    'dsh-client-ui-permission-presets',
]

# template placeholder -> (sheet, full class name)
PLACEHOLDERS = {
    'FRAME': ('dsh-client-ui-layout', 'pI_x6G_frame'),
    'SIDEBARCOL': ('dsh-client-ui-layout', 'pI_x6G_sidebarCol'),
    'CENTERCOL': ('dsh-client-ui-layout', 'pI_x6G_centerCol'),
    'SIDEBARROOT': ('dsh-client-ui-sidebar', 'hHd-Xa_root'),
    'LOGOROW': ('dsh-client-ui-sidebar', 'hHd-Xa_logoRow'),
    'BRAND': ('dsh-client-ui-sidebar', 'hHd-Xa_brand'),
    'BRANDIDENTITY': ('dsh-client-ui-sidebar', 'hHd-Xa_brandIdentity'),
    'BRANDMARK': ('dsh-client-ui-sidebar', 'hHd-Xa_brandMark'),
    'BRANDNAME': ('dsh-client-ui-sidebar', 'hHd-Xa_brandName'),
    'NEWSESSION': ('dsh-client-ui-sidebar', 'hHd-Xa_newSession'),
    'NEWSESSIONLABEL': ('dsh-client-ui-sidebar', 'hHd-Xa_newSessionLabel'),
    'ICONBTN': ('dsh-client-ui-sidebar', 'hHd-Xa_iconButton'),
    'REGIONAREA': ('dsh-client-ui-sidebar', 'hHd-Xa_regionArea'),
    'FOOTAREA': ('dsh-client-ui-sidebar', 'hHd-Xa_footArea'),
    'LISTAREA': ('dsh-client-ui-workspace', 'bhn1Oq_listArea'),
    'GROUPSECTION': ('dsh-client-ui-workspace', 'bhn1Oq_groupSection'),
    'PROJECTROW': ('dsh-client-ui-workspace', 'YDXeBa_projectRow'),
    'SESSIONROW': ('dsh-client-ui-workspace', 'YDXeBa_sessionRow'),
    'SECTIONHEADER': ('dsh-client-ui-workspace', 'bhn1Oq_sectionHeader'),
    'CONVROOT': ('dsh-client-ui-conversation', 'wSkVaW_root'),
    'SCROLLBODY': ('dsh-client-ui-conversation', 'wSkVaW_scrollBody'),
    'COMPOSERSEAT': ('dsh-client-ui-conversation', 'wSkVaW_composerSeat'),
    'COMPOSERSTACK': ('dsh-client-ui-conversation', 'wSkVaW_composerStack'),
    'HEROROOT': ('dsh-client-ui-conversation', 'pXSMma_root'),
    'HEADLINE': ('dsh-client-ui-conversation', 'pXSMma_headline'),
    'HEADLINETEXT': ('dsh-client-ui-conversation', 'pXSMma_headlineText'),
    'PREVIEWBADGE': ('dsh-client-ui-conversation', 'pXSMma_previewBadge'),
    'UVROOT': ('dsh-client-ui-conversation', 'uV2eYG_root'),
    'CARD': ('dsh-client-ui-conversation', 'uV2eYG_card'),
    'INPUT': ('dsh-client-ui-conversation', 'uV2eYG_input'),
    'PLACEHOLDER': ('dsh-client-ui-conversation', 'uV2eYG_placeholder'),
    'ADD': ('dsh-client-ui-conversation', 'uV2eYG_add'),
    'PRIMARY': ('dsh-client-ui-conversation', 'uV2eYG_primary'),
    'MODELTRIGGER': ('dsh-client-ui-conversation', 'Sh0Q9G_trigger'),
    'MODELTRIGGERLABEL': ('dsh-client-ui-conversation', 'Sh0Q9G_triggerLabel'),
    'PERMSELECTOR': ('dsh-client-ui-permission-presets', 'oY77xG_selector'),
    'CHATROOT': ('dsh-client-ui-chat', 'EvIC1a_root'),
    'CHATSCROLL': ('dsh-client-ui-chat', 'EvIC1a_scroll'),
    'BUBBLE': ('dsh-client-ui-chat', 'Sixlwa_bubble'),
}


def read(path, fallback=''):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except OSError:
        return fallback


def main():
    sheets = {}
    for pkg in SHEETS:
        path = os.path.join(CSS_DIR, pkg + '.css')
        if not os.path.isfile(path):
            sys.exit('missing %s\nrun: python tools/extract_dsh_css.py --dump-dir tools/_dshcss' % path)
        sheets[pkg] = read(path)

    bad = [('%s (in %s)' % (cls, pkg)) for _, (pkg, cls) in PLACEHOLDERS.items() if ('.' + cls) not in sheets[pkg]]
    if bad:
        sys.exit('these class names are NOT in the installed DSH stylesheets:\n  ' + '\n  '.join(bad))

    favicon = re.sub(r'<\?xml[^>]*\?>', '', read(FAVICON)).strip()
    theme_css = read(os.path.join(ROOT, 'lib', 'theme.css'))
    theme_js = read(os.path.join(ROOT, 'lib', 'theme.js'))
    pet_css = read(os.path.join(ROOT, 'lib', 'pet.css'))
    pet_js = read(os.path.join(ROOT, 'lib', 'pet.js'))
    trail_js = read(os.path.join(ROOT, 'lib', 'trail.js'))
    if not theme_css:
        sys.exit('lib/theme.css is empty')

    # 壁纸以 data URI 内联，让复刻页保持自包含
    wall_path = os.path.join(ROOT, 'assets', 'iuno-wall.jpg')
    if os.path.isfile(wall_path):
        import base64
        with open(wall_path, 'rb') as f:
            wall_uri = 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode('ascii')
    else:
        wall_uri = ''

    # 桌宠贴纸同样内联（可选，缺失时复刻页不显示桌宠）
    import base64
    pet_uri = ''
    pet_path = os.path.join(ROOT, 'assets', 'iuno-pet.png')
    if os.path.isfile(pet_path):
        with open(pet_path, 'rb') as f:
            pet_uri = 'data:image/png;base64,' + base64.b64encode(f.read()).decode('ascii')

    css = '\n'.join('/* ===== %s (real DSH stylesheet) ===== */\n%s' % (p, sheets[p]) for p in SHEETS)
    css += '\n/* ===== repo skin: lib/theme.css ===== */\n' + theme_css
    css += '\n/* ===== repo pet: lib/pet.css ===== */\n' + pet_css

    html = TEMPLATE.replace('/*__DSH_CSS__*/', css)
    html = html.replace('__FAVICON_SMALL__', '<span style="width:34px;height:34px;display:inline-flex">' + favicon + '</span>')
    html = html.replace('__FAVICON__', favicon)
    html = html.replace('/*__PREVIEW_HOOK__*/', 'window.__YN_PREVIEW = { wall: %s, pet: %s };' % (json.dumps(wall_uri), json.dumps(pet_uri)))
    html = html.replace('/*__THEME_JS__*/', theme_js + '\n' + pet_js + '\n' + trail_js)
    for key, (_, cls) in PLACEHOLDERS.items():
        html = html.replace('__%s__' % key, cls)

    left = re.findall(r'__[A-Z_]+__', html)
    if left:
        sys.exit('unresolved placeholders: %s' % sorted(set(left)))

    out = os.path.join(ROOT, 'skin-preview.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('skin-preview.html written: %.1f KB' % (os.path.getsize(out) / 1024.0))
    print('verified %d real DSH class names across %d stylesheets' % (len(PLACEHOLDERS), len(SHEETS)))


TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>尤诺主题 · DSH 界面复刻预览</title>
<style>/*__DSH_CSS__*/</style>
<style>
  html,body{height:100%}
  body{margin:0}
  #root{height:100vh}
  .yn-demo-bar{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483600;
    display:flex;gap:8px;align-items:center;padding:8px 12px;border-radius:12px;
    background:rgba(8,14,32,.86);border:1px solid rgba(232,205,138,.28);backdrop-filter:blur(8px);
    font:12px/1.4 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#e6eefc}
  .yn-demo-bar b{color:#f0cf8a;font-weight:600;letter-spacing:.12em;font-size:11px}
  .yn-demo-bar button{font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;cursor:pointer;
    color:#f2d391;background:rgba(232,205,138,.10);border:1px solid rgba(232,205,138,.34)}
  .yn-demo-bar button:hover{background:rgba(232,205,138,.22)}
  .yn-demo-bar .sep{width:1px;height:18px;background:rgba(232,205,138,.25)}
  .replica-row{display:flex;align-items:center;gap:8px;padding:8px 12px}
  .replica-spacer{flex:1}
  /* DSH 的组件样式用 display:flex 覆盖了 [hidden]，复刻页需要强制隐藏 */
  [hidden]{display:none !important}
  /* 真实 DSH 里这些间距/对齐来自 React 内联样式，复刻页用最小样式补齐 */
  [class*="_groupSection"],[class*="_sectionHeader"]{justify-content:flex-start;text-align:left}
  [class*="_sectionHeader"]{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px 8px}
  [class*="_projectRow"],[class*="_sessionRow"]{display:flex;align-items:center;gap:8px;height:32px;
    padding:0 8px;border-radius:8px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer}
  [class*="_projectRow"]{color:var(--dsw-alias-label-primary)}
  [class*="_projectRow"]:hover,[class*="_sessionRow"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
  [class*="_footArea"] button{width:auto;height:32px;padding:0 10px;gap:8px;white-space:nowrap;
    font-size:13px;justify-content:flex-start;color:var(--dsw-alias-label-secondary)}
  [class*="_regionArea"]{flex:1;min-height:0;overflow:auto;margin-top:4px}
  [class*="_sidebarCol"] [class*="_root"]{display:flex;flex-direction:column;height:100%}
  /* 给顶部演示条让位 */
  [class*="_scrollBody"]{padding-top:58px}
  .replica-msg{max-width:680px;margin:0 auto;padding:18px 24px;font-size:14px;line-height:1.75;color:var(--dsw-alias-label-primary)}
  .replica-msg code{background:var(--dsw-alias-markdown-inline-code);border-radius:4px;padding:1px 5px;font-size:12.5px}
  .replica-user{display:flex;justify-content:flex-end;padding:10px 24px}
</style>
</head>
<body data-ds-dark-theme>
<div class="yn-demo-bar">
  <b>SKIN PREVIEW</b>
  <span>真实 DSH 组件样式 + 真实类名 + 本仓库皮肤</span>
  <span class="sep"></span>
  <button id="v-hero">起始页</button>
  <button id="v-chat">对话页</button>
  <button id="v-light">切亮色</button>
  <button id="v-amb">氛围 关/淡/标准</button>
</div>

<div id="root">
  <div class="__FRAME__" style="grid-template-columns:236px minmax(0,1fr)">
    <aside class="__SIDEBARCOL__">
      <div class="__SIDEBARROOT__">
        <div class="__LOGOROW__">
          <button class="__BRAND__">
            <span class="__BRANDIDENTITY__">
              <span class="__BRANDMARK__">__FAVICON__</span>
              <span class="__BRANDNAME__">deepseek <span style="font-weight:400;opacity:.7">HARNESS</span></span>
            </span>
          </button>
          <button class="__ICONBTN__" title="收起侧栏">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
              <rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M6 2.5v11"/></svg>
          </button>
        </div>
        <button class="__NEWSESSION__">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M8 3v10M3 8h10" stroke-linecap="round"/></svg>
          <span class="__NEWSESSIONLABEL__">新会话</span>
        </button>
        <div class="__REGIONAREA__">
          <div class="__LISTAREA__">
            <div class="__GROUPSECTION__">
              <div class="__SECTIONHEADER__">工作区</div>
              <div class="__PROJECTROW__">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
                  <path d="M1.8 4.2A1.2 1.2 0 0 1 3 3h3l1.3 1.6H13a1.2 1.2 0 0 1 1.2 1.2v6A1.2 1.2 0 0 1 13 13H3a1.2 1.2 0 0 1-1.2-1.2z"/></svg>
                kllmtmp
              </div>
              <div class="__SESSIONROW__">新会话</div>
              <div class="__SESSIONROW__" style="opacity:.72">https://github.com/MeteorN…</div>
            </div>
            <div class="__GROUPSECTION__">
              <div class="__SECTIONHEADER__">未分组</div>
            </div>
          </div>
        </div>
        <div class="__FOOTAREA__">
          <button class="__ICONBTN__" title="设置">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <circle cx="8" cy="8" r="2.4"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"/></svg>
            设置
          </button>
        </div>
      </div>
    </aside>

    <main class="__CENTERCOL__">
      <div class="__CONVROOT__" data-phase="hero">
        <div class="__SCROLLBODY__">
          <div class="__HEROROOT__">
            <div class="__HEADLINE__">
              <span>__FAVICON_SMALL__</span>
              <span class="__HEADLINETEXT__">探索未至之境</span>
              <span class="__PREVIEWBADGE__">预览版</span>
            </div>
          </div>
          <div class="__COMPOSERSEAT__">
            <div class="__COMPOSERSTACK__">
              <div class="__UVROOT__">
                <div class="__CARD__">
                  <div class="__INPUT__"><span class="__PLACEHOLDER__">描述你想要构建的内容… / 敲击指令 @ 文件或对话</span></div>
                  <div class="replica-row">
                    <button class="__ADD__">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
                        <path d="M8 3.4v9.2M3.4 8h9.2" stroke-linecap="round"/></svg>
                    </button>
                    <button class="__PERMSELECTOR__">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                        <circle cx="8" cy="8" r="6"/><path d="M8 5.4v3.2l2 1.4"/></svg>
                      完全权限
                    </button>
                    <span class="replica-spacer"></span>
                    <button class="__MODELTRIGGER__"><span class="__MODELTRIGGERLABEL__">Deepseek-Flash&nbsp;&nbsp;High</span></button>
                    <button class="__PRIMARY__">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M8 13V3.6M4.2 7.4 8 3.6l3.8 3.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="__CONVROOT__" data-phase="active" hidden>
        <div class="__SCROLLBODY__">
          <div class="replica-user"><div class="__BUBBLE__">把整个界面换成尤诺主题</div></div>
          <div class="replica-msg">
            <p style="margin:0 0 10px">已把 <code>--dsw-*</code> 令牌整体重映射：底色转为深空藏青，发丝线偏金，主按钮改为饰金渐变。</p>
            <p style="margin:0">星尘、月晕与月环由氛围层叠加，只加光不遮挡文字。</p>
          </div>
        </div>
        <div class="__COMPOSERSEAT__">
          <div class="__COMPOSERSTACK__">
            <div class="__UVROOT__">
              <div class="__CARD__">
                <div class="__INPUT__"><span class="__PLACEHOLDER__">描述你想要构建的内容… / 敲击指令 @ 文件或对话</span></div>
                <div class="replica-row">
                  <button class="__ADD__">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
                      <path d="M8 3.4v9.2M3.4 8h9.2" stroke-linecap="round"/></svg>
                  </button>
                  <button class="__PERMSELECTOR__">完全权限</button>
                  <span class="replica-spacer"></span>
                  <button class="__MODELTRIGGER__"><span class="__MODELTRIGGERLABEL__">Deepseek-Flash&nbsp;&nbsp;High</span></button>
                  <button class="__PRIMARY__">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                      <path d="M8 13V3.6M4.2 7.4 8 3.6l3.8 3.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</div>

<script>
/* 复刻页交互：切换视图 / 亮色 / 氛围浓度 */
(function () {
  var hero = document.querySelector('[data-phase="hero"]');
  var chat = document.querySelector('[data-phase="active"]');
  function show(which) {
    hero.hidden = which !== 'hero';
    chat.hidden = which !== 'chat';
  }
  document.getElementById('v-hero').addEventListener('click', function () { show('hero') });
  document.getElementById('v-chat').addEventListener('click', function () { show('chat') });
  document.getElementById('v-light').addEventListener('click', function () {
    if (document.body.hasAttribute('data-ds-dark-theme')) document.body.removeAttribute('data-ds-dark-theme');
    else document.body.setAttribute('data-ds-dark-theme', '');
  });
  var levels = [1, 0.55, 0];
  var li = 0;
  document.getElementById('v-amb').addEventListener('click', function () {
    li = (li + 1) % levels.length;
    if (window.__ynSetAmbience) window.__ynSetAmbience(levels[li]);
  });
  var q = new URLSearchParams(location.search);
  if (q.get('nodemo') || q.get('bare')) {
    var st = document.createElement('style');
    st.textContent = '.yn-demo-bar{display:none !important}';
    document.head.appendChild(st);
  }
  show(q.get('view') === 'chat' ? 'chat' : 'hero');
  if (q.get('light') !== null) document.body.removeAttribute('data-ds-dark-theme');
  /* 壁纸构图调试：?wall=74,22 & zoom=116 & blur=5 */
  setTimeout(function () {
    var wall = document.querySelector('.yn-skin-wall');
    if (!wall) return;
    var w = (q.get('wall') || '').split(',');
    if (w.length === 2) wall.style.backgroundPosition = w[0] + '% ' + w[1] + '%';
    if (q.get('zoom')) wall.style.backgroundSize = 'auto ' + q.get('zoom') + '%';
    if (q.get('blur')) wall.style.filter = 'brightness(.84) saturate(1.06) blur(' + q.get('blur') + 'px)';
  }, 300);
})();
</script>
<script>/*__PREVIEW_HOOK__*/</script>
<script>/*__THEME_JS__*/</script>
</body>
</html>
'''

if __name__ == '__main__':
    main()
