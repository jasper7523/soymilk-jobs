# -*- coding: utf-8 -*-
"""
豆漿接案表 v2 — PDF 匯入

跟舊版 sync_jobs.py 的差別：
  舊版：只把「檔名」當案名，PDF 原檔上傳到 catbox.moe（公開圖床）
  這版：讀 PDF 裡的文字寫進「原始訊息」，順便抓金額和期限；PDF 留在本機，不上傳任何地方

還會做兩件事：
  1. 濾掉 Google 表單的罐頭字（「您的回答」「* 表示必填問題」…）
  2. 遮掉個資（Email、手機、LINE ID、身分證），因為試算表是「知道連結的人可檢視」

用法（在這個資料夾裡）：
    python sync_pdf.py --dry     先看抓到什麼，不寫入，產出 _preview.txt
    python sync_pdf.py           真的寫進試算表
設定：同資料夾的 settings.json（不會進 git）
    {"gas_url": "https://script.google.com/macros/s/.../exec",
     "key": "你的通行碼",
     "pdf_dir": "D:\\\\...\\\\00_Job Dashboard",
     "who": "簡"}
"""

import os
import re
import sys
import json
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS = os.path.join(HERE, 'settings.json')
PREVIEW = os.path.join(HERE, '_preview.txt')
DEFAULT_PDF_DIR = os.path.abspath(os.path.join(HERE, '..', '..'))

HEADERS = ['id', 'title', 'status', 'source', 'tag', 'shoot_date', 'location', 'contact',
           'pay_type', 'pay_amount', 'deliverable', 'due_deliver', 'due_publish', 'post_url',
           'raw_message', 'note', 'pdf_url', 'created_at', 'updated_at', 'updated_by']


# ── 輸出（Windows 主控台中文不會爆） ──────────────────────────
def say(msg):
    try:
        print(msg)
    except UnicodeEncodeError:
        enc = sys.stdout.encoding or 'utf-8'
        print(msg.encode(enc, errors='replace').decode(enc))


# ── 設定 ──────────────────────────────────────────────────
def load_settings():
    if not os.path.exists(SETTINGS):
        say('找不到 settings.json。請在 %s 建一個，內容像這樣：' % HERE)
        say(json.dumps({'gas_url': 'https://script.google.com/macros/s/.../exec',
                        'key': '你的通行碼', 'pdf_dir': DEFAULT_PDF_DIR, 'who': '簡'},
                       ensure_ascii=False, indent=2))
        sys.exit(1)
    with open(SETTINGS, 'r', encoding='utf-8') as f:
        s = json.load(f)
    s.setdefault('pdf_dir', DEFAULT_PDF_DIR)
    s.setdefault('who', '簡')
    s.setdefault('key', '')
    return s


# ── 抽文字 ────────────────────────────────────────────────
def read_pdf(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            say('缺套件。先跑：pip install pypdf')
            sys.exit(1)
    reader = PdfReader(path)
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or '')
        except Exception:
            pass
    return '\n'.join(parts)


# Google 表單的罐頭字，整行丟掉
BOILERPLATE = [
    '切換帳戶', '未共用的項目', '已儲存草稿', '表示必填問題', '您的回答',
    '請勿利用', 'Google 並未認可', '服務條款', '隱私權政策', '這份表單很可疑',
    '聯絡表單擁有者', '清除表單', '提交', '系統絕不會透過', '回報濫用情形',
    '這份表單是在', '建立的', 'docs.google.com/forms',
]
# 個資／私人答案欄位標籤：這行和下一行都丟掉
PII_LABELS = ['姓名', '真實姓名', '本名', '年齡', '生日', '出生', '性別', '身分證',
              '手機', '電話', '聯絡電話', 'Email', 'E-mail', '信箱', '電子郵件',
              'LINE ID', 'Line ID', 'line id', '居住', '現居', '地址', '銀行', '帳號',
              '匯款', '郵局', '戶名', '目前職業', '職業', '代步工具', '身高', '體重',
              '三圍', '鞋號', '尺寸']

RE_EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
RE_PHONE = re.compile(r'09\d{2}[\s\-]?\d{3}[\s\-]?\d{3}')
RE_ID = re.compile(r'\b[A-Z][12]\d{8}\b')


def clean_text(raw):
    """濾罐頭字、遮個資，回傳乾淨的多行文字"""
    lines = [re.sub(r'\s+', ' ', ln).strip() for ln in raw.splitlines()]
    out = []
    skip_next = False
    for ln in lines:
        if not ln:
            continue
        if skip_next:
            skip_next = False
            # 下一行若是答案（短且沒有標點），直接丟
            if len(ln) < 40:
                continue
        if any(b in ln for b in BOILERPLATE):
            continue
        if any(ln.startswith(p) or ln.rstrip(' *：:').endswith(p) for p in PII_LABELS):
            skip_next = True
            continue
        ln = RE_EMAIL.sub('［信箱已遮］', ln)
        ln = RE_PHONE.sub('［手機已遮］', ln)
        ln = RE_ID.sub('［身分證已遮］', ln)
        out.append(ln)
    # 連續重複行收掉
    dedup = []
    for ln in out:
        if not dedup or dedup[-1] != ln:
            dedup.append(ln)
    return '\n'.join(dedup).strip()


# ── 從文字猜欄位 ───────────────────────────────────────────
RE_MONEY = re.compile(r'(?:NT\$|NT ?\$|\$|＄)\s*([\d,]{3,9})|([\d,]{3,9})\s*元')
# 左邊 18 字裡出現這些，才算「她拿得到的錢」
PAY_CTX = ['費用', '薪資', '稿費', '報酬', '酬勞', '車馬費', '時薪', '日薪', '班',
           '有酬', '預算', '合作金額', '報價']
# 左邊 18 字裡出現這些，就是商品標價，不是報酬
PRICE_CTX = ['市價', '價值', '原價', '售價', '市售', '定價', '總價', '價格', '售',
            '商品價', '建議售價', '折扣', '優惠價', '會員價']
MUTUAL_WORDS = ['互惠', '無酬', '免費提供', '無償', '產品體驗合作', '體驗合作']
PAID_WORDS = ['有酬', '費用', '薪資', '稿費', '報酬', '酬勞', '分潤']


def guess_money(text):
    """
    只認「報酬語境」裡的金額，而且全篇候選唯一時才填。
    原因：級距表（1500/2500/3500…）填哪個都是錯的；商品市價更不是她的報酬。
    """
    cands = set()
    for m in RE_MONEY.finditer(text):
        v = (m.group(1) or m.group(2) or '').replace(',', '')
        if not v.isdigit():
            continue
        n = int(v)
        if not (300 <= n <= 300000):
            continue
        left = text[max(0, m.start() - 18):m.start()]
        if any(w in left for w in PRICE_CTX):
            continue
        if not any(w in left for w in PAY_CTX):
            continue
        cands.add(n)
    if len(cands) == 1:
        return str(cands.pop())
    return ''


def guess_pay_type(text, amount):
    mutual = any(w in text for w in MUTUAL_WORDS)
    paid = bool(amount) or any(w in text for w in PAID_WORDS)
    if mutual and paid:
        return '兩者'
    if mutual:
        return '互惠'
    if paid:
        return '有酬'
    return '未定'


# 「9/15～10/31 發文」「於 9/4 前完成發布」「10/8 前上架」
RE_DUE = re.compile(r'(\d{1,2})\s*/\s*(\d{1,2})\s*(?:日)?\s*(?:前|以前|之前)?[^\n]{0,12}?'
                    r'(發文|發布|發佈|上架|曝光|上線|完成|截止|交件|交稿|提供)')
RE_DUE2 = re.compile(r'(?:發文|發布|發佈|上架|曝光|上線|截止|交件|交稿|完成)[^\n]{0,12}?'
                     r'(\d{1,2})\s*/\s*(\d{1,2})')


def guess_due(text):
    """抓發文／交件期限。年份用今年；若日期落在半年以前，當成明年。"""
    m = RE_DUE.search(text) or RE_DUE2.search(text)
    if not m:
        return ''
    g = m.groups()
    mo, d = (int(g[0]), int(g[1])) if g[0] and g[0].isdigit() else (0, 0)
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return ''
    now = datetime.now()
    y = now.year
    try:
        dt = datetime(y, mo, d)
    except ValueError:
        return ''
    if (now - dt).days > 180:
        y += 1
    return '%d/%02d/%02d' % (y, mo, d)


# 順序有意義：先判斷比較明確的。KOC 放最後，因為「創作者」幾乎每份都會出現。
TAG_RULES = [('活動', ['工作人員', '接待人員', '活動人員', '現場協助', '帶位', '招募工作']),
             ('團購', ['團購', '開團', '分潤']),
             ('拍攝', ['拍攝模特', '模特兒', '麻豆', '平面拍攝', '攝影棚', '演員徵選']),
             ('探店', ['探店', '到店', '門市體驗', '用餐', '試吃']),
             ('體驗', ['體驗合作', '開箱體驗', '試用', '互惠體驗']),
             ('KOC', ['KOC', 'KOL', '開箱', '體驗'])]


def guess_tag(text, filename):
    hay = filename + '\n' + text[:1200]
    for tag, words in TAG_RULES:
        if any(w in hay for w in words):
            return tag
    return ''


JUNK_TITLE = re.compile(r'^(報名表|圖文|平面|招募|表單|$)')


TITLE_END = '。！？!?）)】」』・…'


def guess_title(text, filename):
    """
    優先用 PDF 開頭那段有意義的文字當案名，比檔名準。
    PDF 常在中途斷行（「…現場工 / 作人員報名表」），所以會把被切斷的下一行接回來。
    """
    base = re.sub(r'\.pdf$', '', filename, flags=re.I).strip()
    lines = [ln.strip(' 　*:：') for ln in text.splitlines()[:14]]
    for i, ln in enumerate(lines):
        if len(ln) < 6 or len(ln) > 60:
            continue
        if any(b in ln for b in BOILERPLATE):
            continue
        if re.match(r'^[\d\s/:：\-]+$', ln):
            continue
        # 看起來被切斷（夠長、結尾沒有標點）就接下一行
        nxt = lines[i + 1] if i + 1 < len(lines) else ''
        if len(ln) >= 16 and ln[-1] not in TITLE_END and 0 < len(nxt) <= 14 \
                and not any(b in nxt for b in BOILERPLATE) \
                and not re.match(r'^[\d\s/:：\-]+$', nxt):
            ln = ln + nxt
        return ln[:60]
    return base


def extract_deliverable(text, title):
    """從「合作內容」那一段抓，不要抓到標題行"""
    body = text
    for anchor in ['合作形式', '合作內容', '合作方式', '需求', '任務', '發文形式', '內容形式']:
        i = body.find(anchor)
        if i >= 0:
            body = body[i:i + 400]
            break
    else:
        body = text[len(title):]          # 沒有錨點就至少跳過標題
    for pat in [r'(IG\s*Reels[^\n]{0,30})', r'(Reels[^\n]{0,25})',
                r'(Threads[^\n]{0,25})', r'(短影音[^\n]{0,20})', r'(圖文[^\n]{0,20})']:
        m = re.search(pat, body)
        if m:
            s = m.group(1).strip()[:60]
            if s and s not in title:
                return s
    return ''


def pdf_key(filename):
    """PDF 的識別碼：去掉副檔名和「 (2)」「 (3)」。gas_v2.js 的 pdfKey_ 用同一套規則。"""
    s = re.sub(r'\.pdf$', '', filename, flags=re.I)
    s = re.sub(r'\s*\(\d+\)\s*$', '', s)
    return s.strip()


def build_job(path, filename):
    raw = read_pdf(path)
    text = clean_text(raw)
    amount = guess_money(text)
    ctime = datetime.fromtimestamp(os.path.getctime(path))
    job = {h: '' for h in HEADERS}
    job['title'] = guess_title(text, filename)
    job['status'] = 'inquiry'
    job['source'] = '報名'
    job['tag'] = guess_tag(text, filename)
    job['pay_type'] = guess_pay_type(text, amount)
    job['pay_amount'] = amount
    job['deliverable'] = extract_deliverable(text, job['title'])
    job['due_publish'] = guess_due(text)
    job['raw_message'] = text[:12000]
    job['pdf_url'] = pdf_key(filename)   # 只記檔名，檔案留在本機，不上傳
    job['created_at'] = ctime.strftime('%Y/%m/%d %H:%M')
    return job, len(raw)


# ── 寫入 ──────────────────────────────────────────────────
def post(gas_url, payload):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(gas_url, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('User-Agent', 'Mozilla/5.0')
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    dry = '--dry' in sys.argv
    s = load_settings()
    folder = s['pdf_dir']
    if not os.path.isdir(folder):
        say('找不到 PDF 資料夾：%s' % folder)
        sys.exit(1)

    files = sorted(f for f in os.listdir(folder)
                   if f.lower().endswith('.pdf') and os.path.isfile(os.path.join(folder, f)))
    say('PDF 資料夾：%s' % folder)
    say('找到 %d 份 PDF' % len(files))

    jobs, preview, seen = [], [], set()
    dup = 0
    for i, fn in enumerate(files, 1):
        key = pdf_key(fn)
        if key in seen:                      # 同一份報名表存過好幾次，只留一份
            dup += 1
            continue
        seen.add(key)
        path = os.path.join(folder, fn)
        try:
            job, rawlen = build_job(path, fn)
        except Exception as e:
            say('  [%d/%d] %s → 讀取失敗：%s' % (i, len(files), fn[:30], e))
            continue
        jobs.append(job)
        say('  [%d/%d] %s' % (i, len(files), job['title'][:36]))
        preview.append(
            '─' * 60 + '\n'
            '檔案　　：%s\n案名　　：%s\n類型　　：%s\n報酬　　：%s %s\n'
            '要交什麼：%s\n發文期限：%s\n收到日　：%s\n原始字數：%d（原始 %d）\n'
            '訊息前 300 字：\n%s\n'
            % (fn, job['title'], job['tag'] or '（無）',
               job['pay_type'], job['pay_amount'] or '', job['deliverable'] or '（無）',
               job['due_publish'] or '（無）', job['created_at'],
               len(job['raw_message']), rawlen, job['raw_message'][:300]))

    with open(PREVIEW, 'w', encoding='utf-8') as f:
        f.write('\n'.join(preview))
    say('')
    say('預覽已寫到：%s' % PREVIEW)

    filled = sum(1 for j in jobs if j['pay_amount'])
    dued = sum(1 for j in jobs if j['due_publish'])
    say('處理 %d 份（重複檔名跳過 %d 份）；抓到金額 %d 份、抓到發文期限 %d 份'
        % (len(jobs), dup, filled, dued))

    if dry:
        say('')
        say('這是 --dry 試跑，沒有寫進試算表。看過預覽檔沒問題，再跑一次不加 --dry。')
        return

    if not s.get('gas_url'):
        say('settings.json 沒有 gas_url，無法寫入。')
        sys.exit(1)

    say('')
    say('寫入試算表…')
    added = filled = untouched = 0
    for i in range(0, len(jobs), 20):          # 分批，避免一次太大
        chunk = jobs[i:i + 20]
        res = post(s['gas_url'], {'action': 'upsert_many', 'key': s.get('key', ''),
                                  'who': s.get('who', '簡'), 'jobs': chunk})
        if not res.get('ok'):
            say('失敗：%s' % res.get('error'))
            if res.get('error') == 'bad key':
                say('（settings.json 的 key 跟 Apps Script 裡設的不一樣）')
            sys.exit(1)
        added += res.get('added', 0)
        filled += res.get('filled', 0)
        untouched += res.get('untouched', 0)
        say('  第 %d 批：新增 %d、補內容 %d、沒變動 %d'
            % (i // 20 + 1, res.get('added', 0), res.get('filled', 0), res.get('untouched', 0)))
    say('')
    say('完成。新增 %d 筆、補內容 %d 筆、沒變動 %d 筆。重新整理網頁就看得到。'
        % (added, filled, untouched))
    say('（補內容＝那一列本來就在，只把空欄位填上；你們手打過的東西不會被蓋掉）')


if __name__ == '__main__':
    main()
