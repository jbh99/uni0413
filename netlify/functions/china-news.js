// Netlify Serverless Function — 아주경제 중국 뉴스 RSS + HTML 스크래핑
// Node 18+ built-in fetch 사용 (외부 의존성 없음)
//
// 핵심 원칙:
//   1. 각 기사(article) 단위로 HTML 블록을 격리하여 title/link/image/date/excerpt 를 한 덩어리로 추출
//   2. 이미지·링크·제목이 엇갈리지 않도록 article 경계를 넘나들지 않음
//   3. URL 정규화 (쿼리·프래그먼트 제거) 후 중복 제거
//   4. 같은 이미지가 여러 기사에 연결되면 후순위 기사의 이미지는 비움 (placeholder 로 fallback)

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300', // 5분 캐시
};

// 아주경제 RSS 후보 URL (중국 섹션 우선)
const RSS_CANDIDATES = [
  'https://www.ajunews.com/rss/S1N1A0C1.xml',
  'https://www.ajunews.com/rss/S1N5A0.xml',
  'https://www.ajunews.com/rss/rss.xml',
];

const AJU_CHINA_PAGE = 'https://www.ajunews.com/china';
const UA = 'Mozilla/5.0 (compatible; UWSNewsBot/1.0)';

function cleanText(str) {
  return (str || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractTag(str, tag) {
  const m = str.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? cleanText(m[1]) : '';
}

function extractCData(str, tag) {
  const m = str.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return m ? cleanText(m[1]) : '';
}

function extractAttr(str, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m = str.match(re);
  return m ? m[1] : '';
}

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\.\s*/g, '.').replace(/\.$/, '');
  }
  const m = (str || '').match(/20\d{2}[.\-\/]\d{2}[.\-\/]\d{2}/);
  return m ? m[0].replace(/[.\-\/]/g, '.') : (str || '').slice(0, 10);
}

// URL 정규화: 쿼리/프래그먼트 제거, /view/ID 만 유지
function normalizeViewUrl(url) {
  if (!url) return '';
  const m = url.match(/\/view\/(\d{10,})/);
  return m ? `https://www.ajunews.com/view/${m[1]}` : url.split('?')[0].split('#')[0];
}

// RSS XML → 뉴스 배열
function parseRSS(xml) {
  const items = [];
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const block of itemMatches) {
    const title = extractCData(block, 'title');
    const link  = extractCData(block, 'link') || extractTag(block, 'link');
    const desc  = extractCData(block, 'description');
    const pub   = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');

    // 이미지: enclosure 또는 media:content 또는 description 내 <img>
    let image = extractAttr(block, 'enclosure', 'url');
    if (!image) {
      const mc = block.match(/<media:content[^>]+url="([^"]+)"/i);
      if (mc) image = mc[1];
    }
    if (!image) {
      const imgM = desc.match(/<img[^>]+src="([^"]+)"/i) || block.match(/<img[^>]+src="([^"]+)"/i);
      if (imgM) image = imgM[1];
    }

    const excerpt = cleanText(desc).slice(0, 150);
    if (!title || title.length < 4) continue;

    // 중국 관련 기사 필터링 (RSS가 전체일 경우)
    const combined = title + excerpt;
    if (!combined.match(/중국|中國|china|홍콩|시진핑|베이징|상하이|선전|광저우|화웨이|알리바바|텐센트/i)) continue;

    const rawLink = (link || '').startsWith('http') ? link : `https://www.ajunews.com${link}`;
    const cleanLink = normalizeViewUrl(rawLink);

    items.push({ title: title.replace(/^\[(속보|종합|단독|연합)\]\s*/,'').trim(), link: cleanLink, excerpt, image, date: fmtDate(pub) });
    if (items.length >= 5) break;
  }
  return dedupeByUrlAndImage(items);
}

// URL 정규화 기반 중복 제거 + 이미지 중복 제거
// 같은 이미지가 여러 기사에 걸리면 후순위 기사의 image를 비워 placeholder로 대체되도록 함
function dedupeByUrlAndImage(items) {
  const urlSeen = new Set();
  const imageSeen = new Set();
  const out = [];
  for (const it of items) {
    const norm = normalizeViewUrl(it.link);
    if (urlSeen.has(norm)) continue;
    urlSeen.add(norm);
    it.link = norm;

    // 이미지 중복 제거 (동일 이미지가 2개 이상 기사에 쓰이면 뒤의 기사는 비움)
    if (it.image) {
      const imgKey = it.image.split('?')[0];
      if (imageSeen.has(imgKey)) it.image = '';
      else imageSeen.add(imgKey);
    }
    out.push(it);
  }
  return out;
}

// ajunews.com/china HTML → 뉴스 배열
//
// 전략: 먼저 기사 컨테이너(<li> / <article> / <div class="...item/card/list...">)를 경계로 HTML 분할
// 각 컨테이너 내부에서만 link/title/image/date/excerpt 추출하므로 이웃 기사와 섞이지 않음.
function parseAjuHtml(html) {
  const results = [];

  // 1) /view/ 링크를 포함하는 article-like 컨테이너 블록을 전수 추출
  //    우선순위: <article>...</article> → <li>...</li> → <div class="*item*|*card*|*list*">...</div>
  const containerPatterns = [
    /<article\b[^>]*>[\s\S]*?<\/article>/gi,
    /<li\b[^>]*>[\s\S]*?<\/li>/gi,
  ];

  const candidateBlocks = [];
  for (const re of containerPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const blk = m[0];
      if (/\/view\/\d{10,}/.test(blk)) candidateBlocks.push(blk);
    }
    if (candidateBlocks.length >= 5) break;
  }

  // 2) 기사 블록이 충분치 않으면 링크 주변 좁은 창(±400 chars)으로 fallback
  if (candidateBlocks.length < 2) {
    const linkPattern = /href="((?:https?:\/\/www\.ajunews\.com)?\/view\/\d{10,})"/g;
    let m;
    while ((m = linkPattern.exec(html)) !== null) {
      const start = Math.max(0, m.index - 400);
      const end = Math.min(html.length, m.index + 400);
      candidateBlocks.push(html.slice(start, end));
      if (candidateBlocks.length >= 8) break;
    }
  }

  // 3) 각 블록에서 title/link/image/date/excerpt 추출
  const seen = new Set();
  for (const block of candidateBlocks) {
    if (results.length >= 5) break;

    // 링크 (해당 블록 내 /view/ 링크 중 첫 번째)
    const linkM = block.match(/href="((?:https?:\/\/www\.ajunews\.com)?\/view\/\d{10,})"/);
    if (!linkM) continue;
    const rawUrl = linkM[1].startsWith('http') ? linkM[1] : 'https://www.ajunews.com' + linkM[1];
    const url = normalizeViewUrl(rawUrl);
    if (seen.has(url)) continue;
    seen.add(url);

    // 제목 — h 태그 / title 클래스 / strong 순으로 탐색
    const titleM = block.match(/class="[^"]*(?:tit|title|subject|heading|headline)[^"]*"[^>]*>([^<]{6,})<\//) ||
                   block.match(/<h[1-6][^>]*>([^<]{6,})<\/h[1-6]>/i) ||
                   block.match(/<strong[^>]*>([^<]{6,})<\/strong>/i) ||
                   block.match(/<a[^>]+href="[^"]*\/view\/\d{10,}"[^>]*>([^<]{6,})<\/a>/i);
    if (!titleM) continue;
    const title = cleanText(titleM[1]).replace(/^\[(속보|종합|단독|연합)\]\s*/, '').trim();
    if (!title || title.length < 5) continue;

    // 이미지 — 같은 블록 안에서만
    let image = '';
    const imgM = block.match(/<img[^>]+src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"?]*(?:\?[^"]*)?)"/i);
    if (imgM) image = imgM[1];

    // 날짜 — 20YY.MM.DD / 20YY-MM-DD / 20YY/MM/DD
    const dateM = block.match(/(20\d{2})[.\-\/\s](\d{1,2})[.\-\/\s](\d{1,2})/);
    const date = dateM ? `${dateM[1]}.${dateM[2].padStart(2,'0')}.${dateM[3].padStart(2,'0')}` : '';

    // 본문 요약
    const descM = block.match(/class="[^"]*(?:desc|summary|lead|txt|sub|excerpt)[^"]*"[^>]*>([^<]{10,})<\//);
    const excerpt = descM ? cleanText(descM[1]).slice(0, 130) : '';

    results.push({ title, link: url, excerpt, image, date });
  }

  return dedupeByUrlAndImage(results);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  // ── 1순위: RSS 피드 (중국 카테고리) ──
  for (const rssUrl of RSS_CANDIDATES) {
    try {
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRSS(xml);
      if (items.length >= 2) {
        console.log('[china-news] RSS OK:', rssUrl, items.length);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, source: 'rss', items }) };
      }
    } catch (e) {
      console.warn('[china-news] RSS failed:', rssUrl, e.message);
    }
  }

  // ── 2순위: ajunews.com/china HTML 직접 스크래핑 ──
  try {
    const res = await fetch(AJU_CHINA_PAGE, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const items = parseAjuHtml(html);
    if (items.length >= 1) {
      console.log('[china-news] HTML scrape OK:', items.length);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, source: 'html', items }) };
    }
    throw new Error('HTML 파싱 결과 없음');
  } catch (e) {
    console.error('[china-news] HTML failed:', e.message);
  }

  // ── 실패 ──
  return {
    statusCode: 500,
    headers: HEADERS,
    body: JSON.stringify({ ok: false, error: '뉴스를 불러올 수 없습니다', items: [] }),
  };
};
