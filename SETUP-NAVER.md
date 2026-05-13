# 네이버 로그인 설정 가이드

> 네이버 로그인은 **네이버 개발자센터의 Client ID** 가 반드시 필요합니다.
> 코드만으로는 동작하지 않으며, 아래 절차를 1번만 수행하면 영구 동작합니다.

## 📋 5분 안에 끝내는 설정 (3단계)

### 1단계 — 네이버 개발자센터에서 애플리케이션 등록 (3분)

1. https://developers.naver.com/apps/#/register 접속 (네이버 계정 로그인)
2. **애플리케이션 등록** 화면에서 다음과 같이 입력:

   | 항목 | 입력값 |
   |---|---|
   | 애플리케이션 이름 | `Uni-World Services` |
   | 사용 API | **네이버 로그인** 체크 |
   | 제공 정보 선택 | `회원이름`, `이메일주소`, `프로필사진` 체크 (필수) |
   | 환경 | **PC웹** + **모바일웹** 모두 체크 |
   | 서비스 URL | `https://unws2.netlify.app` |
   | Callback URL | `https://unws2.netlify.app/naver-callback.html` |

3. **등록하기** 클릭 → **Client ID** 와 **Client Secret** 발급됨 (메모해 두기)

### 2단계 — Client ID 를 코드에 입력 (30초)

`index.html` 파일에서 `NAVER_AUTH_CONFIG` 를 찾아 (대략 1212번째 줄):

```javascript
let NAVER_AUTH_CONFIG = {
  clientId: "",       // ← 여기에 발급받은 Client ID 붙여넣기
  callbackUrl: ""
};
```

**아래처럼 수정:**

```javascript
let NAVER_AUTH_CONFIG = {
  clientId: "여기에_복사한_Client_ID_입력",
  callbackUrl: ""
};
```

> ⚠️ Client **ID** 만 코드에 입력하세요. **Secret** 은 절대 코드에 넣지 마세요!

### 3단계 — Client Secret 을 Netlify 환경변수에 추가 (1분)

서버 함수에서 토큰 교환 시 필요합니다.

1. Netlify 대시보드 → **Site settings** → **Environment variables**
2. **Add a variable** 클릭하여 다음 추가:

   | Key | Value |
   |---|---|
   | `NAVER_CLIENT_ID` | (1단계에서 발급받은 Client ID — 2단계와 동일) |
   | `NAVER_CLIENT_SECRET` | (1단계에서 발급받은 Client Secret) |

3. **Deploys** → **Trigger deploy** → **Deploy site** 로 재배포

## ✅ 동작 확인

1. https://unws2.netlify.app 접속 후 로그인 화면 열기
2. **네이버 계정으로 로그인** 버튼 클릭
3. 네이버 인증 팝업 → 동의 → 자동 로그인 완료

## 🔧 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| "네이버 로그인 준비 중입니다" | Client ID 미설정 | 2단계 확인 |
| "Naver credentials not configured" | Netlify 환경변수 누락 | 3단계 확인 |
| "redirect_uri_mismatch" | Callback URL 불일치 | 1단계 Callback URL 정확히 등록 |
| "보안 검증에 실패" | state 미스매치 | 브라우저 캐시 삭제 후 재시도 |
| 팝업이 안 열림 | 브라우저 팝업 차단 | 사이트 팝업 허용 설정 |

## 🔐 보안 노트

- **Client ID** — 공개 식별자. 코드에 노출되어도 됨 (OAuth redirect URL 에 포함됨)
- **Client Secret** — 절대 클라이언트로 노출 금지. Netlify 서버 함수에서만 접근.
- **Callback URL** — Naver 가 redirect 하는 정확한 경로. 서비스 URL 에 등록된 것만 허용.

## 📞 발급 후 동일 절차 — Google 로그인

Firebase Auth 는 이미 인라인 fallback 으로 즉시 동작 가능 (apiKey 는 공개 식별자). 단,
다음만 추가로 확인:

1. **Firebase Console** → **Authentication** → **Sign-in method** → **Google** 사용 설정
2. **Authentication** → **Settings** → **Authorized domains** 에 `unws.netlify.app` 추가
