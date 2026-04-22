// Netlify Serverless Function — 홍콩 법인등기처(CR) 정책 뉴스 스크래핑 + Netlify Blobs DB 누적
// Node 18+ fetch 사용 / @netlify/blobs 영구 저장

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300', // 5분 캐시
};

const CR_URL = 'https://www.cr.gov.hk/en/about/news/highlights.htm';
const CR_BASE = 'https://www.cr.gov.hk';
const UA = 'Mozilla/5.0 (compatible; UWSNewsBot/1.0)';
const BLOB_STORE = 'hk-policy';
const BLOB_KEY   = 'accumulated-items';

// 텍스트 정제
function cleanText(str) {
  return (str || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// 날짜 정규화: "17 April 2026" → "2026.04.17"
const MONTHS = {
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12,
};
function parseDate(str) {
  if (!str) return '';
  const m = (str || '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const mm = String(MONTHS[m[2].toLowerCase()] || 0).padStart(2, '0');
    return `${m[3]}.${mm}.${m[1].padStart(2, '0')}`;
  }
  // YYYY-MM-DD 계열
  const m2 = (str || '').match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);
  return m2 ? `${m2[1]}.${m2[2]}.${m2[3]}` : (str || '').slice(0, 10);
}

// cr.gov.hk highlights 페이지 파싱
function parseCRPage(html) {
  const items = [];
  const seen  = new Set();

  // 패턴 A: <div class="..."> 또는 <li> 안에 <a href="*.htm"> 링크 + 날짜 텍스트
  // cr.gov.hk는 보통 <ul> 리스트에 연도별로 항목 배치
  const linkRe = /<a\s[^>]*href="([^"]*\.htm[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const rawHref = m[1];
    const rawTitle = cleanText(m[2]);
    if (!rawTitle || rawTitle.length < 15) continue; // 너무 짧은 건 메뉴 링크

    // 홍콩 법인등기처 뉴스 링크 패턴
    const isNewsLink = /\/(news|highlights|whatsnew|announce|press|circular|update)/i.test(rawHref)
                    || /\/(en|tc|sc)\//i.test(rawHref);
    if (!isNewsLink && !rawHref.startsWith('http')) {
      // 상대 경로가 아닌 외부 링크는 건너뜀
      if (!rawHref.startsWith('/')) continue;
    }

    const url = rawHref.startsWith('http') ? rawHref : CR_BASE + rawHref;
    if (seen.has(url)) continue;
    seen.add(url);

    // 주변 블록에서 날짜·요약 추출
    const start = Math.max(0, m.index - 600);
    const end   = Math.min(html.length, m.index + 1200);
    const block = html.slice(start, end);

    const dateM = block.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
    const date  = parseDate(dateM ? dateM[1] : '');

    // 요약 문장 추출: <p> 태그 안 첫 문장
    const paraM = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    let excerpt = paraM ? cleanText(paraM[1]) : '';
    if (!excerpt || excerpt.length < 10) {
      // 태그 제거 후 링크 텍스트 이후 텍스트
      const stripped = cleanText(block.replace(/<[^>]+>/g, ' '));
      const afterTitle = stripped.indexOf(rawTitle);
      if (afterTitle >= 0) excerpt = stripped.slice(afterTitle + rawTitle.length, afterTitle + rawTitle.length + 250).trim();
    }
    excerpt = excerpt.slice(0, 250);

    if (rawTitle.length >= 15) {
      items.push({ id: url, title: rawTitle, url, date, excerpt });
    }
    if (items.length >= 20) break;
  }

  // 패턴 B: 날짜가 앞에 있는 형식 — "17 April 2026\nTitle..."
  if (items.length < 2) {
    const dateLineRe = /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})([\s\S]{0,20}?<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>)/gi;
    while ((m = dateLineRe.exec(html)) !== null) {
      const date  = parseDate(m[1]);
      const href  = m[3];
      const title = cleanText(m[4]);
      if (!title || title.length < 10) continue;
      const url = href.startsWith('http') ? href : CR_BASE + href;
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ id: url, title, url, date, excerpt: '' });
      if (items.length >= 20) break;
    }
  }

  return items;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  const force = (event.queryStringParameters || {}).force === '1';
  const modeQuery = (event.queryStringParameters || {}).mode || '';

  // ── Netlify Blobs 에서 기존 DB 로드 ──
  let db    = [];
  let store = null;
  try {
    const { getStore } = require('@netlify/blobs');
    store = getStore({ name: BLOB_STORE, consistency: 'strong' });
    const raw = await store.get(BLOB_KEY, { type: 'json' });
    if (raw && Array.isArray(raw)) {
      db = raw;
      console.log('[hk-policy] Blob DB loaded:', db.length, 'items');
    }
  } catch (e) {
    // 로컬 개발 환경이거나 Blobs 미설정 → 조용히 무시
    console.warn('[hk-policy] Blob unavailable:', e.message);
  }

  // DB만 반환 모드 (force 아닐 때 캐시로 활용)
  if (!force && db.length >= 3 && modeQuery !== 'refresh') {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, source: 'db', items: db, total: db.length }),
    };
  }

  // ── cr.gov.hk 라이브 스크래핑 ──
  let freshItems = [];
  try {
    const res = await fetch(CR_URL, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    freshItems = parseCRPage(html);
    console.log('[hk-policy] Scraped', freshItems.length, 'items from CR');
  } catch (e) {
    console.error('[hk-policy] Scrape failed:', e.message);
  }

  // ── DB 병합 (중복 제거, 최신 순) ──
  if (freshItems.length > 0) {
    const existingIds = new Set(db.map(i => i.id));
    const newItems    = freshItems.filter(i => !existingIds.has(i.id));
    if (newItems.length > 0 || force) {
      db = [...newItems, ...db];  // 최신 항목이 앞
      // Netlify Blobs 에 저장
      if (store) {
        try {
          await store.set(BLOB_KEY, JSON.stringify(db));
          console.log('[hk-policy] DB saved:', db.length, 'total,', newItems.length, 'new');
        } catch (e) {
          console.warn('[hk-policy] Blob save failed:', e.message);
        }
      }
    }
  }

  const allItems = db.length > 0 ? db : freshItems;

  if (allItems.length === 0) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: 'CR 데이터를 불러올 수 없습니다', items: [] }),
    };
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      ok: true,
      source: freshItems.length > 0 ? 'live' : 'db',
      items: allItems,
      total: allItems.length,
    }),
  };
};
