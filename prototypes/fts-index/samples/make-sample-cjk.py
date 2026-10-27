#!/usr/bin/env python3
"""Regenerate sample-cjk.pdf (CC0). Needs reportlab + TrueType CJK fonts.

Default font search looks under /usr/share/fonts for Ma Shan Zheng (zh),
DotGothic16 (ja), Gothic A1 (ko). Override with FONT_ZH / FONT_JA / FONT_KO.
"""
from pathlib import Path
import os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, ArrayObject, NumberObject, NameObject

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'sample-cjk.pdf'

def find_font(env, *globs):
    if os.environ.get(env):
        return Path(os.environ[env])
    base = Path('/usr/share/fonts')
    for g in globs:
        hits = list(base.rglob(g))
        if hits:
            return hits[0]
    raise FileNotFoundError(f'font for {env} not found; set {env}')

fonts = {
    'zh': find_font('FONT_ZH', 'MaShanZheng-Regular.ttf', 'ZCOOLXiaoWei-Regular.ttf'),
    'ja': find_font('FONT_JA', 'DotGothic16-Regular.ttf', 'BIZUDPMincho-Regular.ttf'),
    'ko': find_font('FONT_KO', 'GothicA1-Regular.ttf', 'NanumGothic-Regular.ttf'),
}
for k, p in fonts.items():
    pdfmetrics.registerFont(TTFont(f'cjk_{k}', str(p)))

c = canvas.Canvas(str(OUT), pagesize=A4)
_, H = A4

def draw_page(lines, bookmark=None, level=0):
    y = H - 72
    for font, size, text in lines:
        c.setFont(font, size)
        c.drawString(72, y, text)
        y -= size + 8
    if bookmark:
        c.bookmarkPage(bookmark)
        c.addOutlineEntry(bookmark, bookmark, level=level)
    c.showPage()

draw_page([
    ('cjk_zh', 18, '前言'),
    ('cjk_zh', 11, 'ZotLit PDF Full-Text Search Prototype'),
    ('cjk_zh', 11, '本样本为自拟演示文稿，许可 CC0 1.0。'),
    ('cjk_zh', 11, '版本控制系统（VCS）帮助团队协作管理源代码。'),
    ('cjk_zh', 11, 'Git is a distributed version control system.'),
    ('cjk_zh', 11, '示例短语：pre-commit、git-scm.com、C++、v2.4.0。'),
    ('cjk_zh', 10, 'page label: i (index 0)'),
], '前言')
draw_page([
    ('cjk_zh', 16, '1. 入门 / Getting Started'),
    ('cjk_zh', 11, '第一章介绍仓库、提交与分支的基本概念。'),
    ('cjk_zh', 11, 'A repository stores commits. Creating a branch is cheap.'),
    ('cjk_zh', 11, '暂存区（staging area）位于工作目录与仓库之间。'),
    ('cjk_zh', 11, '常用操作包括克隆（clone）、合并（merge）与变基（rebase）。'),
    ('cjk_zh', 10, 'page label: 1 (index 1)'),
], '1. 入门 / Getting Started')
draw_page([
    ('cjk_zh', 16, '1.1 分布式工作流'),
    ('cjk_zh', 11, '分布式版本控制系统允许每位贡献者拥有完整历史。'),
    ('cjk_zh', 11, 'Remote remotes track upstream branches.'),
    ('cjk_zh', 11, '快进（fast-forward）合并在无分叉时发生。'),
    ('cjk_ja', 11, '日本語：バージョン管理システム。'),
    ('cjk_ko', 11, '한국어: 저장소 관리 예제.'),
    ('cjk_zh', 10, 'page label: 2 (index 2)'),
], '1.1 分布式工作流', level=1)
draw_page([
    ('cjk_zh', 16, '2. 进阶主题'),
    ('cjk_zh', 11, '标签（tag）标记发布点，例如 v2.4.0。'),
    ('cjk_zh', 11, 'Hyphenation test: inter-'),
    ('cjk_zh', 11, 'nationalization across a line break (Latin).'),
    ('cjk_zh', 11, '中文断行测试：版本'),
    ('cjk_zh', 11, '控制系统应保持页码索引稳定。'),
    ('cjk_zh', 11, '查询「版本控制」或「控制」应能命中本页。'),
    ('cjk_zh', 10, 'page label: 3 (index 3)'),
], '2. 进阶主题')
c.save()

r = PdfReader(str(OUT))
w = PdfWriter(); w.append(r)
nums = ArrayObject([
    NumberObject(0), DictionaryObject({NameObject('/S'): NameObject('/r')}),
    NumberObject(1), DictionaryObject({NameObject('/S'): NameObject('/D')}),
])
w._root_object[NameObject('/PageLabels')] = DictionaryObject({NameObject('/Nums'): nums})
tmp = str(OUT) + '.tmp'
with open(tmp, 'wb') as f: w.write(f)
os.replace(tmp, OUT)
print('wrote', OUT, OUT.stat().st_size)
