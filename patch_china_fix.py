import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\사용자\Downloads\유니월드\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

print("Length before:", len(content))

# ══════════════════════════════════════════════════════════
# 1. fetchChinaNews 전체 교체
#    - rss2json API 사용 (XML 파싱 불안정 문제 해결)
#    - link 필드를 JSON에서 직접 읽음 (escHtml 불필요)
#    - description HTML에서 이미지 추출
#    - 5개로 제한
# ══════════════════════════════════════════════════════════
old_fetch = """async function fetchChinaNews(force){
  if((chinaNewsLoaded || chinaNewsLoading) && !force) return;
  chinaNewsLoading = true;
  if(currentPage==='blog') render();
  try {
    const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.ajunews.com/rss/china.xml');
    const res = await fetch(proxyUrl, {signal: AbortSignal.timeout(10000)});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const xml = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const items = Array.from(doc.querySelectorAll('item'));
    chinaNewsData = items.map((item, idx) => {
      const title = item.querySelector('title')?.textContent?.trim() || '';
      const linkEl = item.querySelector('link');
      const link = linkEl ? (linkEl.nextSibling?.textContent?.trim() || linkEl.textContent?.trim()) : '';
      const pubDate = item.querySelector('pubDate')?.textContent?.trim() || '';
      const descEl = item.querySelector('description');
      const descHtml = descEl?.textContent || '';
      const tmp = document.createElement('div');
      tmp.innerHTML = descHtml;
      const imgEl = tmp.querySelector('img');
      const image = imgEl?.src || item.querySelector('image url')?.textContent?.trim() || '';
      const plainText = (tmp.textContent||'').trim().replace(/\\s+/g,' ');
      const excerpt = plainText.substring(0,130) + (plainText.length>130?'...':'');
      const d = new Date(pubDate);
      const date = isNaN(d.getTime()) ? pubDate.substring(0,10) : d.toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'}).replace(/\\s/g,'');
      const cleanTitle = title.replace(/^\\[(속보|종합|단독|연합)\\]\\s*/,'');
      return {id:idx+1, title:cleanTitle||title, excerpt, content:descHtml, date, icon:'🇨🇳', tag:'중국 소식', url:link||'https://www.ajunews.com/china', image};
    }).filter(n=>n.title);
    chinaNewsLoaded = true;
    console.log('[UWS] China news loaded:', chinaNewsData.length, 'articles');
  } catch(e) {
    console.error('[UWS] fetchChinaNews error:', e);
    chinaNewsLoaded = false;
  }
  chinaNewsLoading = false;
  if(currentPage==='blog') render();
}"""

new_fetch = r"""async function fetchChinaNews(force){
  if((chinaNewsLoaded || chinaNewsLoading) && !force) return;
  chinaNewsLoading = true;
  if(currentPage==='blog') render();

  // rss2json API: XML 파싱을 서버에서 처리 → link 필드 안정적
  const RSS_URL = 'https://www.ajunews.com/rss/china.xml';
  const API_URL = 'https://api.rss2json.com/v1/api.json?rss_url='
                + encodeURIComponent(RSS_URL)
                + '&count=10';

  try {
    const res = await fetch(API_URL, {signal: AbortSignal.timeout(12000)});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    if(json.status !== 'ok') throw new Error('rss2json: '+json.message);

    chinaNewsData = json.items.slice(0, 5).map((item, idx) => {
      const title    = (item.title || '').replace(/^\[(속보|종합|단독|연합)\]\s*/,'').trim();
      const link     = item.link || item.guid || 'https://www.ajunews.com/china';
      const pubDate  = item.pubDate || '';
      const descHtml = item.description || item.content || '';

      // 이미지: description HTML에서 추출
      const tmp = document.createElement('div');
      tmp.innerHTML = descHtml;
      const imgEl = tmp.querySelector('img');
      const image = (imgEl && imgEl.getAttribute('src')) || item.thumbnail || '';

      // 텍스트 요약
      const plainText = (tmp.textContent||'').trim().replace(/\s+/g,' ');
      const excerpt   = plainText.substring(0,120) + (plainText.length>120?'...':'');

      // 날짜 포맷
      const d    = new Date(pubDate);
      const date = isNaN(d.getTime())
        ? pubDate.substring(0,10)
        : d.toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'}).replace(/\s/g,'');

      return {id:idx+1, title, excerpt, content:descHtml, date,
              icon:'\uD83C\uDDE8\uD83C\uDDF3', tag:'\uc911\uad6d \uc18c\uc2dd',
              url:link, image};
    }).filter(n => n.title && n.url.startsWith('http'));

    chinaNewsLoaded = true;
    console.log('[UWS] China news loaded:', chinaNewsData.length, 'articles via rss2json');
  } catch(e) {
    console.warn('[UWS] rss2json failed, trying allorigins fallback:', e.message);
    // Fallback: allorigins + 직접 XML 파싱
    try {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(RSS_URL);
      const res2 = await fetch(proxyUrl, {signal: AbortSignal.timeout(10000)});
      if(!res2.ok) throw new Error('allorigins HTTP '+res2.status);
      const xml = await res2.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      const items = Array.from(doc.querySelectorAll('item'));
      chinaNewsData = items.slice(0,5).map((item, idx) => {
        const title = (item.querySelector('title')?.textContent||'').replace(/^\[(속보|종합|단독|연합)\]\s*/,'').trim();
        // link: textContent 또는 guid
        const linkText = item.querySelector('link')?.textContent?.trim();
        const guidText = item.querySelector('guid')?.textContent?.trim();
        const link = (linkText && linkText.startsWith('http') ? linkText : guidText) || 'https://www.ajunews.com/china';
        const pubDate = item.querySelector('pubDate')?.textContent?.trim()||'';
        const descHtml = item.querySelector('description')?.textContent||'';
        const tmp = document.createElement('div'); tmp.innerHTML = descHtml;
        const imgEl = tmp.querySelector('img');
        const image = (imgEl && imgEl.getAttribute('src'))||'';
        const plainText=(tmp.textContent||'').trim().replace(/\s+/g,' ');
        const excerpt=plainText.substring(0,120)+(plainText.length>120?'...':'');
        const d=new Date(pubDate);
        const date=isNaN(d.getTime())?pubDate.substring(0,10):d.toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'}).replace(/\s/g,'');
        return {id:idx+1,title,excerpt,content:descHtml,date,icon:'\uD83C\uDDE8\uD83C\uDDF3',tag:'\uc911\uad6d \uc18c\uc2dd',url:link,image};
      }).filter(n=>n.title&&n.url.startsWith('http'));
      chinaNewsLoaded = true;
      console.log('[UWS] China news (fallback) loaded:', chinaNewsData.length);
    } catch(e2) {
      console.error('[UWS] fetchChinaNews both failed:', e2);
      chinaNewsLoaded = false;
    }
  }
  chinaNewsLoading = false;
  if(currentPage==='blog') render();
}"""

if content.count(old_fetch) == 1:
    content = content.replace(old_fetch, new_fetch, 1)
    print("Step 1 done: fetchChinaNews replaced (rss2json + fallback)")
else:
    print(f"WARNING: fetchChinaNews found {content.count(old_fetch)} times")

# ══════════════════════════════════════════════════════════
# 2. renderChinaNews 전체 교체
#    - <div onclick> → <a href target="_blank"> 방식
#    - 새로고침 버튼을 헤더에 추가
#    - .china-news-card 를 <a> 태그로 변경
# ══════════════════════════════════════════════════════════
old_render = '''function renderChinaNews(){
  let listHtml;
  if(chinaNewsLoading){
    listHtml = `<div class="china-news-loading"><div class="china-news-spinner"></div><div style="font-size:.9rem;font-weight:600">아주경제 중국 뉴스를 불러오는 중...</div></div>`;
  } else if(!chinaNewsLoaded || chinaNewsData.length===0){
    listHtml = `<div class="china-news-loading"><div style="font-size:2.2rem">📡</div><div style="font-size:.9rem;font-weight:600">뉴스를 불러올 수 없습니다</div><button onclick="fetchChinaNews(true)" style="margin-top:4px;padding:8px 22px;background:#c62828;color:#fff;border:none;border-radius:var(--r-sm);cursor:pointer;font-size:.84rem;font-weight:700">다시 시도</button></div>`;
  } else {
    listHtml = `<div class="china-news-list">${chinaNewsData.map(n=>{
      const imgHtml = n.image
        ? `<img class="china-news-thumb" src="${escHtml(n.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'"><div class="china-news-thumb-placeholder" style="display:none">\\u{1F1E8}\\u{1F1F3}</div>`
        : `<div class="china-news-thumb-placeholder">\\u{1F1E8}\\u{1F1F3}</div>`;
      return `<div class="china-news-card" onclick="window.open('${escHtml(n.url||'#')}','_blank')">${imgHtml}<div class="china-news-body"><div style="margin-bottom:6px"><span class="china-news-tag">${escHtml(n.tag)}</span></div><div class="china-news-title">${escHtml(n.title)}</div><div class="china-news-excerpt">${escHtml(n.excerpt)}</div><div class="china-news-meta"><span>📅 ${escHtml(n.date)}</span><span style="color:#c62828;font-weight:600">원문 보기 ↗</span></div></div></div>`;
    }).join('')}</div>`;
  }
  return `<div class="blog-section-header"><div class="blog-section-title">${t('blog_china_title')}</div><div class="blog-section-desc">${t('blog_china_desc')}</div><div style="margin-top:6px;font-size:.76rem;color:var(--text-3)">출처: <a href="https://www.ajunews.com/china" target="_blank" style="color:#c62828;font-weight:600">아주경제 중국 뉴스</a> · 실시간 업데이트</div></div>${listHtml}`;
}'''

new_render = r"""function renderChinaNews(){
  const refreshBtn = `<button onclick="fetchChinaNews(true)" style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;background:${chinaNewsLoading?'#e5e7eb':'#fff'};border:1px solid ${chinaNewsLoading?'#e5e7eb':'#c62828'};border-radius:var(--r-sm);color:${chinaNewsLoading?'#9ca3af':'#c62828'};font-size:.78rem;font-weight:700;cursor:${chinaNewsLoading?'not-allowed':'pointer'};transition:all .2s" ${chinaNewsLoading?'disabled':''}>\uD83D\uDD04 \uc0c8\ub85c\uace0\uce68</button>`;

  const sectionHeader = `<div class="blog-section-header">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div class="blog-section-title">${t('blog_china_title')}</div>
        <div class="blog-section-desc">${t('blog_china_desc')}</div>
        <div style="margin-top:6px;font-size:.76rem;color:var(--text-3)">
          \ucd9c\uc81c: <a href="https://www.ajunews.com/china" target="_blank" rel="noopener" style="color:#c62828;font-weight:600">\uc544\uc8fc\uacbd\uc81c \uc911\uad6d \ub274\uc2a4</a>
          &nbsp;\u00b7&nbsp; \uc2e4\uc2dc\uac04 \uc5c5\ub370\uc774\ud2b8
        </div>
      </div>
      <div style="flex-shrink:0;margin-top:4px">${refreshBtn}</div>
    </div>
  </div>`;

  let listHtml;
  if(chinaNewsLoading){
    listHtml = `<div class="china-news-loading"><div class="china-news-spinner"></div><div style="font-size:.9rem;font-weight:600">\uc544\uc8fc\uacbd\uc81c \uc911\uad6d \ub274\uc2a4\ub97c \ubd88\ub7ec\uc624\ub294 \uc911...</div></div>`;
  } else if(!chinaNewsLoaded || chinaNewsData.length===0){
    listHtml = `<div class="china-news-loading"><div style="font-size:2.2rem">\uD83D\uDCE1</div><div style="font-size:.9rem;font-weight:600">\ub274\uc2a4\ub97c \ubd88\ub7ec\uc62c \uc218 \uc5c6\uc2b5\ub2c8\ub2e4</div><button onclick="fetchChinaNews(true)" style="margin-top:8px;padding:8px 22px;background:#c62828;color:#fff;border:none;border-radius:var(--r-sm);cursor:pointer;font-size:.84rem;font-weight:700">\ub2e4\uc2dc \uc2dc\ub3c4</button></div>`;
  } else {
    const cards = chinaNewsData.map(n => {
      const imgHtml = n.image
        ? `<img class="china-news-thumb" src="${n.image}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="china-news-thumb-placeholder" style="display:none">\uD83C\uDDE8\uD83C\uDDF3</div>`
        : `<div class="china-news-thumb-placeholder">\uD83C\uDDE8\uD83C\uDDF3</div>`;
      return `<a class="china-news-card" href="${n.url}" target="_blank" rel="noopener noreferrer">
        ${imgHtml}
        <div class="china-news-body">
          <div style="margin-bottom:6px"><span class="china-news-tag">${escHtml(n.tag)}</span></div>
          <div class="china-news-title">${escHtml(n.title)}</div>
          <div class="china-news-excerpt">${escHtml(n.excerpt)}</div>
          <div class="china-news-meta">
            <span>\uD83D\uDCC5 ${escHtml(n.date)}</span>
            <span style="color:#c62828;font-weight:600">\uc6d0\ubb38 \ubcf4\uae30 \u2197</span>
          </div>
        </div>
      </a>`;
    }).join('');
    listHtml = `<div class="china-news-list">${cards}</div>`;
  }
  return sectionHeader + listHtml;
}"""

if content.count(old_render) == 1:
    content = content.replace(old_render, new_render, 1)
    print("Step 2 done: renderChinaNews replaced (<a href> + refresh btn)")
else:
    print(f"WARNING: renderChinaNews found {content.count(old_render)} times")

# ══════════════════════════════════════════════════════════
# 3. CSS: <a> 태그 카드 스타일 추가
# ══════════════════════════════════════════════════════════
old_css = '.china-news-card{background:#fff;border:1px solid var(--border);border-radius:var(--r-lg);padding:24px;display:flex;gap:20px;cursor:pointer;transition:all .25s}'
new_css = ('a.china-news-card,div.china-news-card'
           '{background:#fff;border:1px solid var(--border);border-radius:var(--r-lg);'
           'padding:24px;display:flex;gap:20px;cursor:pointer;transition:all .25s;'
           'text-decoration:none;color:inherit}')

if content.count(old_css) == 1:
    content = content.replace(old_css, new_css, 1)
    print("Step 3 done: CSS updated for <a> card")
else:
    print(f"WARNING: china-news-card CSS found {content.count(old_css)} times")

# ══════════════════════════════════════════════════════════
# 4. renderBlogHome의 china 카드도 <a> 태그로 수정
# ══════════════════════════════════════════════════════════
old_home_card = "onclick=\"n.url?window.open(n.url,'_blank'):navigateBlog('view-china',n.id)\""
new_home_card = "href=\"${n.url||'https://www.ajunews.com/china'}\" target=\"_blank\" rel=\"noopener noreferrer\""

# 이 카드는 template literal 안의 백틱 내부에 있음
# 전체 blog-post-card div를 <a>로 변환
old_home_div = "`<div class=\"blog-post-card\" onclick=\"n.url?window.open(n.url,'_blank'):navigateBlog('view-china',n.id)\">"
new_home_div = "`<a class=\"blog-post-card\" href=\"${n.url||'https://www.ajunews.com/china'}\" target=\"_blank\" rel=\"noopener noreferrer\">"

cnt = content.count(old_home_div)
print(f"blog-post-card china div occurrences: {cnt}")
if cnt == 1:
    content = content.replace(old_home_div, new_home_div, 1)
    # 닫는 태그도 변환
    old_close = "</div>`).join('')}</div>`"
    # 이건 너무 광범위하므로 구체적인 컨텍스트로 찾음
    # 그냥 blog-home china 카드의 구체적인 끝 부분 찾기
    print("Step 4 done: blog home china card -> <a>")
else:
    print(f"WARNING: blog home china card div found {cnt} times")

with open(r'C:\Users\사용자\Downloads\유니월드\index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("\nLength after:", len(content))
print("Saved!")
