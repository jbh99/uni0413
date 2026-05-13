// Netlify Serverless Function — Naver OAuth 2.0 Token Exchange
// 네이버 인증 후 받은 code를 access_token으로 교환하고 사용자 프로필을 조회합니다.
// Client Secret은 절대 클라이언트로 노출되지 않습니다 (서버 환경변수에서만 사용).
//
// 필요 환경변수:
//   NAVER_CLIENT_ID
//   NAVER_CLIENT_SECRET
//
// 클라이언트 호출 예시:
//   POST /.netlify/functions/naver-callback
//   { "code": "...", "state": "..." }
//
// 응답:
//   { ok: true, profile: { id, email, name, nickname, profile_image } }

const ALLOWED_ORIGINS = [
  'https://unws2.netlify.app',
  'https://unws.netlify.app',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
];
// Netlify deploy-preview / branch-deploy 서브도메인도 허용
// (예: deploy-preview-3--unws2.netlify.app, main--unws2.netlify.app)
const ALLOWED_HOSTNAME_SUFFIXES = [
  '--unws2.netlify.app',
  '--unws.netlify.app',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && ALLOWED_HOSTNAME_SUFFIXES.some((s) => u.hostname.endsWith(s))) return true;
    if (['localhost', '127.0.0.1'].includes(u.hostname)) return true;
  } catch (_) {}
  return false;
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowedOrigin = isAllowedOrigin(origin) || isAllowedOrigin(event.headers.referer || '');

  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (!allowedOrigin) {
    return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: 'Origin not allowed' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const missing = [
      !clientId && 'NAVER_CLIENT_ID',
      !clientSecret && 'NAVER_CLIENT_SECRET',
    ].filter(Boolean).join(', ');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: `Netlify 환경변수 누락: ${missing}. Site settings → Environment variables 에서 추가하고 재배포하세요.`,
      }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Invalid JSON body' }) };
  }

  const { code, state } = payload;
  if (!code || !state) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing code or state' }) };
  }

  try {
    // 1) code → access_token 교환
    const tokenUrl = new URL('https://nid.naver.com/oauth2.0/token');
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    tokenUrl.searchParams.set('client_id', clientId);
    tokenUrl.searchParams.set('client_secret', clientSecret);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('state', state);

    const tokenRes = await fetch(tokenUrl.toString(), {
      method: 'GET',
      headers: { 'User-Agent': 'UWS-NaverAuth/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: tokenData.error_description || tokenData.error || 'Token exchange failed',
        }),
      };
    }

    // 2) access_token → 사용자 프로필
    const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'UWS-NaverAuth/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });
    const profileData = await profileRes.json();
    if (!profileRes.ok || profileData.resultcode !== '00' || !profileData.response) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ ok: false, error: profileData.message || 'Profile fetch failed' }),
      };
    }

    const r = profileData.response;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        profile: {
          id: r.id,
          email: r.email || '',
          name: r.name || r.nickname || '',
          nickname: r.nickname || '',
          profile_image: r.profile_image || '',
        },
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: e.message || 'Unexpected server error' }),
    };
  }
};
