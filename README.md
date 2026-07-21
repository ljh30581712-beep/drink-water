# HydroCheck — 배포 가이드 (AI도 놀랄 팀)

## 폴더 구조
```
deploy/
├── index.html        ← 프론트엔드 (사용자 화면)
├── api/
│   └── verify.js      ← 백엔드 (Anthropic API 키를 안전하게 보관, 서버에서만 실행)
├── vercel.json
└── README.md
```

## 배포 순서 (Vercel 무료 배포)

### 1. Anthropic API 키 발급
1. https://console.anthropic.com 가입
2. Settings → API Keys → Create Key
3. 키 복사해두기 (sk-ant-... 형식). **이 키는 어디에도 공개로 올리면 안 됩니다.**
4. 결제 정보 등록 필요 (호출당 비용 발생, 사진 판별은 1회당 매우 저렴함)

### 2. GitHub에 올리기
1. GitHub에서 새 저장소(repository) 생성 (예: `hydrocheck`)
2. 이 `deploy` 폴더 안의 파일들을 그대로 저장소에 업로드
   - `.env` 파일이나 API 키는 **절대 GitHub에 올리지 마세요** (지금 구조는 키를 코드에 넣지 않으므로 안전합니다)

### 3. Vercel 배포
1. https://vercel.com 가입 (GitHub 계정으로 로그인 가능)
2. "Add New Project" → 방금 만든 GitHub 저장소 선택 → Import
3. 배포 전 **Environment Variables** 설정:
   - Key: `ANTHROPIC_API_KEY`
   - Value: 위에서 발급받은 키 (sk-ant-...)
4. Deploy 클릭

### 4. 완료
- 배포가 끝나면 `https://프로젝트이름.vercel.app` 같은 라이브 URL이 생성됩니다
- 이 URL이 공모전에 제출할 "라이브 프로덕트 URL"입니다
- 코드를 수정하고 GitHub에 다시 push하면 Vercel이 자동으로 재배포합니다

## 왜 이 구조인가
- 브라우저(index.html)는 API 키를 전혀 모릅니다. 대신 우리 서버(`/api/verify`)에만 사진을 보냅니다.
- 서버(`api/verify.js`)만 환경변수로 저장된 API 키를 사용해 Anthropic에 요청합니다.
- 이렇게 해야 API 키가 노출되지 않고, 심사위원이 실제 라이브 URL에 접속해도 정상 작동합니다.

## 참고: AI 활용 명세서에 적을 내용
- 사용 AI 모델: Claude (Anthropic, claude-sonnet-4-6)
- 활용 방식: 사용자가 촬영한 사진을 Vision 기능으로 분석해 "물을 마시고 있는지" 판별
- 오픈소스/외부 서비스: Vercel(배포), GitHub(코드 저장소)
