// Netlify Serverless Function — Auth Config Endpoint
// 정적 HTML에 Firebase API Key가 노출되지 않도록 환경변수에서 읽어 응답합니다.
// Origin 화이트리스트 검사로 외부 사이트의 무단 사용을 차단합니다.
//
// 필요 환경변수 (Netlify → Site settings → Build & deploy → Environment):
//   FIREBASE_API_KEY
//   FIREBASE_AUTH_DOMAIN          (예: uniword-e3b0d.firebaseapp.com)
//   FIREBASE_DATABASE_URL         (예: https://uniword-e3b0d-default-rtdb.firebaseio.com)
//   FIREBASE_PROJECT_ID           (예: uniword-e3b0d)
//   FIREBASE_STORAGE_BUCKET       (예: uniword-e3b0d.firebasestorage.app)
//   FIREBASE_MESSAGING_SENDER_ID  (예: 925582403402)
//   FIREBASE_APP_ID
//   FIREBASE_MEASUREMENT_ID       (선택)
//   NAVER_CLIENT_ID               (네이버 개발자센터에서 발급한 Client ID)
//
// 보안 노트: Firebase Web SDK의 apiKey는 공식 문서상 공개 식별자이지만,
// (1) Netlify Secret Scanner의 경고를 회피하고
// (2) 정적 소스에서 즉시 노출되지 않도록 하며
// (3) Origin 검사로 외부 사이트의 사용을 차단하기 위해 이 엔드포인트를 사용합니다.
// 실제 보안은 Firebase Console의 Authorized Domains와 GCP API Key Application
// Restrictions(HTTP referrer)로 강제됩니다.

const ALLOWED_ORIGINS = [
  'https://unws2.netlify.app',
  'https://unws.netlify.app',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((allowed) => origin === allowed || origin.startsWith(allowed));
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const referer = event.headers.referer || event.headers.Referer || '';
  const allowedOrigin = isAllowedOrigin(origin) || isAllowedOrigin(referer);

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'private, max-age=300',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (!allowedOrigin) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Origin not allowed' }),
    };
  }

  const env = process.env;
  const firebase = {
    apiKey: env.FIREBASE_API_KEY || '',
    authDomain: env.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: env.FIREBASE_DATABASE_URL || '',
    projectId: env.FIREBASE_PROJECT_ID || '',
    storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env.FIREBASE_APP_ID || '',
    measurementId: env.FIREBASE_MEASUREMENT_ID || '',
  };

  const naver = {
    clientId: env.NAVER_CLIENT_ID || '',
    callbackUrl: env.NAVER_CALLBACK_URL || `${origin || 'https://unws2.netlify.app'}/naver-callback.html`,
  };

  const ready = {
    firebase: Boolean(firebase.apiKey && firebase.appId),
    naver: Boolean(naver.clientId),
  };

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ ok: true, firebase, naver, ready }),
  };
};
