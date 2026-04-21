// Netlify Serverless Function — 아주경제 중국 뉴스 RSS + HTML 스크래핑
// Node 18+ built-in fetch 사용 (외부 의존성 없음)

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300', // 5분 캐시
};

// 아주경제 RSS 후보 URL (중국 섹션)
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

    const cleanLink = (link || '').startsWith('http') ? link : `https://www.ajunews.com${link}`;

    items.push({ title: title.replace(/^\[(속보|종합|단독|연합)\]\s*/,'').trim(), link: cleanLink, excerpt, image, date: fmtDate(pub) });
    if (items.length >= 5) break;
  }
  return items;
}

// ajunews.com/china HTML → 뉴스 배열
function parseAjuHtml(html) {
  const seen = new Set();
  const results = [];

  // 기사 링크 패턴: /view/숫자
  const linkPattern = /href="((?:https?:\/\/www\.ajunews\.com)?\/view\/\d{10,})"/g;
  let m;
  while ((m = linkPattern.exec(html)) !== null) {
    const href = m[1];
    const url = href.startsWith('http') ? href : 'https://www.ajunews.com' + href;
    if (seen.has(url)) continue;
    seen.add(url);

    // 해당 링크 주변 블록에서 제목/이미지/날짜 추출
    const start = Math.max(0, m.index - 800);
    const end = Math.min(html.length, m.index + 800);
    const block = html.slice(start, end);

    // 제목 추출
    const titleM = block.match(/class="[^"]*(?:tit|title|subject|heading)[^"]*"[^>]*>([^<]{6,})<\//) ||
                   block.match(/<h[1-6][^>]*>([^<]{6,})<\/h[1-6]>/i) ||
                   block.match(/<strong[^>]*>([^<]{6,})<\/strong>/i);
    if (!titleM) continue;
    const title = cleanText(titleM[1]).replace(/^\[(속보|종합|단독|연합)\]\s*/,'').trim();
    if (!title || title.length < 5) continue;

    // 이미지 추출
    const imgM = block.match(/<img[^>]+src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    const image = imgM ? imgM[1] : '';

    // 날짜 추출
    const dateM = block.match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);
    const date = dateM ? `${dateM[1]}.${dateM[2]}.${dateM[3]}` : '';

    // excerpt
    const descM = block.match(/class="[^"]*(?:desc|summary|lead|txt|sub)[^"]*"[^>]*>([^<]{10,})<\//);
    const excerpt = descM ? cleanText(descM[1]).slice(0, 130) : '';

    results.push({ title, link: url, excerpt, image, date });
    if (results.length >= 5) break;
  }
  return results;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  const force = (event.queryStringParameters || {}).force === '1';

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
