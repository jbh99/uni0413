import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\사용자\Downloads\유니월드\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

print("Length before:", len(content))

# ── 기존 fetchStockData + renderStockMarket + stockRefresh 통째로 교체 ──
old_block_start = '// ── WORLD STOCK MARKET ──'
old_block_end   = 'function stockRefresh(){ fetchStockData(true); }\n'

idx_s = content.find(old_block_start)
idx_e = content.find(old_block_end) + len(old_block_end)
print(f"Block found: {idx_s} ~ {idx_e}")

# 새 코드: URL 이중인코딩 수정, lazy-load, 듀얼 프록시 fallback, 상세 에러 로깅
new_block = r"""// ── WORLD STOCK MARKET ──
async function fetchStockData(force){
  if(!force && (stockLoading || stockLoaded)) return;
  stockLoading = true;
  stockLoaded  = false;
  if(currentPage==='blog') render();
  if(_stockRefreshTimer){ clearTimeout(_stockRefreshTimer); _stockRefreshTimer=null; }

  // 프록시 목록 (순서대로 시도)
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest=',
  ];

  const fetchOne = async (idx) => {
    const {symbol, currency, decimals} = idx;
    // ★ 핵심: symbol을 미리 인코딩하지 않고 그대로 붙여서 전체 URL을 한 번만 인코딩
    const yahooUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/'
                   + symbol
                   + '?interval=1d&range=1d&includePrePost=false';

    let json = null;
    let lastErr = null;

    for(const proxy of PROXIES){
      try {
        const res = await fetch(proxy + encodeURIComponent(yahooUrl), {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000)
        });
        if(!res.ok) throw new Error('HTTP '+res.status);
        const text = await res.text();
        json = JSON.parse(text);
        break; // 성공 시 루프 종료
      } catch(e) {
        lastErr = e;
        console.warn('[Stock] proxy failed:', proxy, symbol, e.message);
      }
    }

    if(!json) throw lastErr || new Error('all proxies failed');

    const meta = json?.chart?.result?.[0]?.meta;
    if(!meta) throw new Error('no meta in response');

    const price = meta.regularMarketPrice;
    const prev  = meta.previousClose ?? meta.chartPreviousClose ?? 0;
    if(price == null) throw new Error('no price');

    const change        = price - prev;
    const changePercent = prev ? (change / prev) * 100 : 0;
    const mTime         = meta.regularMarketTime;
    const time          = mTime ? new Date(mTime * 1000) : null;

    return {symbol, price, prev, change, changePercent, currency, decimals, time, ok:true};
  };

  const results = await Promise.allSettled(STOCK_INDICES.map(fetchOne));

  let successCount = 0;
  results.forEach((r, i) => {
    const sym = STOCK_INDICES[i].symbol;
    if(r.status === 'fulfilled'){
      stockData[sym] = r.value;
      successCount++;
    } else {
      stockData[sym] = {error: true, symbol: sym, msg: r.reason?.message};
      console.error('[Stock] final fail:', sym, r.reason?.message);
    }
  });

  console.log('[Stock] loaded ' + successCount + '/' + STOCK_INDICES.length);
  stockLastUpdate = new Date();
  stockLoaded     = true;
  stockLoading    = false;

  if(currentPage === 'blog') render();

  // 5분 자동 갱신
  _stockRefreshTimer = setTimeout(() => {
    stockLoaded = false;
    fetchStockData();
  }, 5 * 60 * 1000);
}

function renderStockMarket(){
  // lazy-load: 증시 탭에 처음 들어오면 자동 fetch 시작
  if(!stockLoaded && !stockLoading) fetchStockData();

  const timeStr = stockLastUpdate
    ? stockLastUpdate.toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'})
    : null;

  const headerHtml = `<div class="blog-section-header">
    <div class="blog-section-title">\uD83C\uDF0F \uc138\uacc4\uc99d\uc2dc</div>
    <div class="blog-section-desc">\ub098\uc2a4\ub2e5 \u00b7 \ucf54\uc2a4\ud53c \u00b7 \ucf54\uc2a4\ub2e5 \u00b7 \ud64d\ucf69H \u00b7 \uc0c1\ud574\uc885\ud569 \u00b7 \ub2db\ucf00\uc774 \uc2e4\uc2dc\uac04 \ud604\ud669</div>
  </div>`;

  const updateBar = `<div class="stock-update-bar">
    <span style="font-size:.8rem;color:var(--text-3)">${
      stockLoading
        ? '\u23f3 \ub370\uc774\ud130 \ub85c\ub529 \uc911...'
        : timeStr
          ? '\uD83D\uDD52 \ub9c8\uc9c0\ub9c9 \uc5c5\ub370\uc774\ud2b8: ' + timeStr
          : '\ub370\uc774\ud130 \ub300\uae30 \uc911'
    }</span>
    <button class="stock-refresh-btn" onclick="stockRefresh()" ${stockLoading ? 'disabled' : ''}>
      \uD83D\uDD04 \uc0c8\ub85c\uace0\uce68
    </button>
  </div>`;

  // ── 로딩 중: 스켈레톤 ──
  if(stockLoading && !stockLoaded){
    const sk = Array.from({length:6}).map(() =>
      `<div class="stock-skeleton">
        <div style="width:32px;height:16px;background:#e5e7eb;border-radius:4px;margin-bottom:8px"></div>
        <div style="width:60%;height:14px;background:#e5e7eb;border-radius:4px;margin-bottom:6px"></div>
        <div style="width:40%;height:10px;background:#e5e7eb;border-radius:4px;margin-bottom:16px"></div>
        <div style="width:80%;height:20px;background:#e5e7eb;border-radius:4px;margin-bottom:8px"></div>
        <div style="width:55%;height:12px;background:#e5e7eb;border-radius:4px"></div>
      </div>`
    ).join('');
    return headerHtml + updateBar + `<div class="stock-loading">${sk}</div>`;
  }

  // ── 데이터 로드 완료 ──
  if(stockLoaded){
    const cards = STOCK_INDICES.map(({symbol, nameKo, nameEn, flag, currency, decimals}) => {
      const d = stockData[symbol];

      if(!d || d.error){
        return `<div class="stock-card flat">
          <div class="stock-flag">${flag}</div>
          <div class="stock-name">${nameKo}</div>
          <div class="stock-name-en">${nameEn}</div>
          <div class="stock-price" style="color:#9ca3af">\u2014</div>
          <div class="stock-change flat" style="font-size:.75rem">\uc7a5\uc644 \ub610\ub294 \ud734\uc7a5\uc77c</div>
          <div class="stock-meta">${currency}</div>
        </div>`;
      }

      const {price, change, changePercent} = d;
      const dir    = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
      const sign   = change >= 0 ? '+' : '';
      const arrow  = change > 0 ? '\u25b2' : change < 0 ? '\u25bc' : '\u25ac';
      const priceStr = price.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
      const chStr  = `${sign}${change.toFixed(decimals)}`;
      const pctStr = `${sign}${changePercent.toFixed(2)}%`;

      return `<div class="stock-card ${dir}">
        <div class="stock-flag">${flag}</div>
        <div class="stock-name">${nameKo}</div>
        <div class="stock-name-en">${nameEn}</div>
        <div class="stock-price">${priceStr}</div>
        <div class="stock-change ${dir}">${arrow} ${chStr} <span style="opacity:.8">(${pctStr})</span></div>
        <div class="stock-meta">${currency}</div>
      </div>`;
    }).join('');

    return headerHtml + updateBar
      + `<div class="stock-grid">${cards}</div>`
      + `<div class="stock-source-note">
           \ucd9c\uc81c: <a href="https://kr.investing.com/" target="_blank" style="color:var(--blue)">Investing.com</a>
           &nbsp;\u00b7&nbsp; \ub370\uc774\ud130: Yahoo Finance
           &nbsp;\u00b7&nbsp; \uc2e4\uc2dc\uac04 15\ubd84 \uc9c0\uc5f0
         </div>`;
  }

  // ── 초기 대기 상태 ──
  return headerHtml
    + `<div class="china-news-loading">
        <div style="font-size:2rem">\uD83D\uDCC9</div>
        <div style="font-size:.9rem;font-weight:600">\uc99d\uc2dc \ub370\uc774\ud130\ub97c \ubd88\ub7ec\uc624\ub294 \uc911\uc785\ub2c8\ub2e4...</div>
       </div>`;
}

function stockRefresh(){ fetchStockData(true); }

"""

content = content[:idx_s] + new_block + content[idx_e:]
print("Block replaced!")
print("Length after:", len(content))

with open(r'C:\Users\사용자\Downloads\유니월드\index.html', 'w', encoding='utf-8') as f:
    f.write(content)
print("Saved!")
