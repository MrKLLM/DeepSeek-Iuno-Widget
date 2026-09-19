"""Extract the runtime-injected CSS from DSH client UI packages (string-literal aware).

Each `dsh-client-ui-*` package inlines its stylesheet as a JS string literal
(usually a double-quoted or template literal). A naive brace scanner also picks
up surrounding JS, so we walk the actual string literals and keep the ones that
look like CSS.

Usage:
  python tools/extract_dsh_css.py --dump-dir <outdir>
  python tools/extract_dsh_css.py <package> [...]
"""
import glob
import json
import os
import re
import sys

DSH = r"C:\Users\KLLM\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai"

STRING_RE = re.compile(
    r'"((?:[^"\\\n]|\\.)*)"'
    r"|'((?:[^'\\\n]|\\.)*)'"
    r'|`((?:[^`\\]|\\.)*)`',
    re.S,
)


def unescape(s):
    """Undo the JS string escaping for the sequences CSS actually contains."""
    return (
        s.replace('\\n', '\n')
        .replace('\\t', '\t')
        .replace('\\"', '"')
        .replace("\\'", "'")
        .replace('\\\\', '\\')
    )


def extract(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()
    chunks = []
    for m in STRING_RE.finditer(text):
        raw = m.group(1) or m.group(2) or m.group(3) or ''
        if '{' not in raw or '}' not in raw:
            continue
        css = unescape(raw)
        # CSS-looking: has at least two rule-ish blocks and a selector character
        if not re.search(r'(^|\})\s*[.#:@\[]?[A-Za-z0-9_.*\[\]"=~^|:-]', css):
            continue
        if css.count('{') < 2:
            continue
        if not re.search(r'(\.|#|@media|@keyframes|:root|body)\s*[A-Za-z0-9_.\[\]"=~^|:-]*\s*\{', css):
            continue
        chunks.append(css)
    return '\n'.join(chunks)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    if args[0] == '--dump-dir':
        outdir = args[1]
        os.makedirs(outdir, exist_ok=True)
        for pkg_dir in sorted(glob.glob(os.path.join(DSH, 'dsh-client-ui-*'))):
            pkg = os.path.basename(pkg_dir)
            client = os.path.join(pkg_dir, 'lib', 'client.js')
            if not os.path.isfile(client):
                continue
            css = extract(client)
            if not css.strip():
                continue
            with open(os.path.join(outdir, pkg + '.css'), 'w', encoding='utf-8') as f:
                f.write(css)
            print('%-42s %6.1f KB  %4d blocks' % (pkg, len(css) / 1024.0, css.count('{')))
        return

    for name in args:
        client = os.path.join(DSH, name, 'lib', 'client.js')
        if not os.path.isfile(client):
            print('!! missing %s' % name)
            continue
        print('/* ===== %s ===== */' % name)
        print(extract(client))


if __name__ == '__main__':
    main()
