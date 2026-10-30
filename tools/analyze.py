# 书库写法统计：python3 tools/analyze.py <小说文件夹> <输出 stats.json>
# 逐本统计句长、段落、对白占比、标点频率、开章和收章习惯，只输出数字，不保存原文。
# 内置风格块里的 metrics 就是用它对作者书库跑出来的（按题材取中位数）。
import os, re, json, sys, statistics as st, random
ROOT = sys.argv[1]; OUT = sys.argv[2]
CH = re.compile(r'^\s*(第[零〇一二两三四五六七八九十百千万0-9０-９]+[章回节卷]|楔子|序章)[^\n]{0,80}$', re.M)
SENT = re.compile(r'[^。！？!?…]+[。！？!?…]+[”」』]?')
DQ = re.compile(r'[“「『][^”」』]*[”」』]')
SHUANG = ['震惊','不可能','倒吸一口凉气','恐怖如斯','目瞪口呆','难以置信','嘶','此子','蝼蚁','找死','打脸','跪下','废物','天才','妖孽','众人','全场','哗然','冷笑','嘴角','微微一笑','淡淡','轰','杀意']
LIT = ['仿佛','好像','似乎','如同','宛如','像是']

def read(p):
    b = open(p, 'rb').read()
    u = b.decode('utf-8', 'replace')
    if u.count('�') < len(u) / 1000: return u
    return b.decode('gb18030', 'replace')

def chapters(t):
    ms = list(CH.finditer(t))
    out = []
    for i, m in enumerate(ms):
        e = ms[i + 1].start() if i + 1 < len(ms) else len(t)
        body = t[m.end():e].strip()
        if 300 < len(body) < 60000: out.append(body)
    return out

def stats(chs):
    paras = []; sents = []; dlg = tot = fp = tp = ex = q = ell = dash = one = shu = lit = de = 0
    endq = endd = endshort = 0; firstdlg = []
    for c in chs:
        ps = [p.strip(' 　\t') for p in c.split('\n') if p.strip(' 　\t')]
        if not ps: continue
        for p in ps:
            paras.append(len(p))
            ss = SENT.findall(p)
            if len(ss) <= 1: one += 1
            sents += [len(s) for s in ss]
        txt = ''.join(ps); n = len(txt); tot += n
        dlg += sum(len(x) for x in DQ.findall(txt))
        nd = DQ.sub('', txt)
        fp += nd.count('我'); tp += nd.count('他') + nd.count('她')
        ex += txt.count('！') + txt.count('!'); q += txt.count('？') + txt.count('?')
        ell += txt.count('……'); dash += txt.count('——')
        shu += sum(txt.count(w) for w in SHUANG); lit += sum(txt.count(w) for w in LIT); de += txt.count('的')
        last = ps[-1]
        if last.endswith(('？', '?')) or '？' in last[-3:]: endq += 1
        if last[:1] in '“「': endd += 1
        if len(last) <= 15: endshort += 1
        m = DQ.search(txt); firstdlg.append(m.start() if m else n)
    k = 1000 / max(tot, 1); nc = max(len(chs), 1)
    return dict(chap_len=int(st.median([len(c) for c in chs])) if chs else 0,
        para_len=round(st.median(paras), 1) if paras else 0, para_one=round(one / max(len(paras), 1), 3),
        sent_len=round(st.mean(sents), 1) if sents else 0, sent_med=st.median(sents) if sents else 0,
        sent_sd=round(st.pstdev(sents), 1) if sents else 0,
        dialog=round(dlg / max(tot, 1), 3), first_person=round(fp / max(fp + tp, 1), 3),
        excl=round(ex * k, 2), ques=round(q * k, 2), ellip=round(ell * k, 2), dash=round(dash * k, 2),
        shuang=round(shu * k, 2), simile=round(lit * k, 2), de=round(de * k, 1),
        end_q=round(endq / nc, 3), end_dialog=round(endd / nc, 3), end_short=round(endshort / nc, 3),
        first_dialog=int(st.median(firstdlg)) if firstdlg else 0)

res = []; files = []
for dp, dn, fn in os.walk(ROOT):
    for f in fn:
        if f.endswith('.txt') and not f.startswith('_'): files.append(os.path.join(dp, f))
files.sort()
for i, p in enumerate(files):
    rel = os.path.relpath(p, ROOT)
    try:
        t = read(p); chs = chapters(t); pseudo = False
        if len(chs) < 20:
            # 没有章节标题：按约 3000 字切段，章长和收章习惯不可信
            i0 = t.find('章节内容开始'); body_t = t[i0 + 12:] if i0 >= 0 else t
            chs = []; cur = []; n = 0
            for x in body_t.split('\n'):
                cur.append(x); n += len(x)
                if n >= 3000: chs.append('\n'.join(cur)); cur = []; n = 0
            pseudo = True
            if len(chs) < 20: res.append(dict(path=rel, skip='太短', n=len(chs))); continue
        random.seed(len(chs))
        idx = sorted(random.sample(range(10, len(chs)), min(80, len(chs) - 10)))
        parts = rel.split(os.sep)
        res.append(dict(path=rel, group='/'.join(parts[:-1]), title=parts[-1][:-4], chars=len(t), chapters=len(chs), pseudo=pseudo,
                        opening=stats(chs[:10]), body=stats([chs[j] for j in idx])))
    except Exception as e:
        res.append(dict(path=rel, err=str(e)))
    if i % 10 == 0: print(i, len(files), flush=True)
json.dump(res, open(OUT, 'w'), ensure_ascii=False)
print('done', len(res))
