<p align="center">
  <img src="assets/logo.svg" width="180" alt="Sding">
</p>

<h1 align="center">웨딩홀 견적 검산기</h1>

<p align="center">그 견적서, 1인당 진짜 얼마인가요?</p>

---

웨딩홀에서 받아온 견적서의 숫자를 **청구인원 기준으로 다시 계산해** 총 예상비용 · 1인당 실질단가 · **허수인원**을 돌려주는 모바일 우선 웹앱입니다.

빌드 스텝도 백엔드도 없습니다. 정적 파일 그대로 GitHub Pages·Netlify·Vercel 어디든 올라갑니다.

## 기능

| 구분 | 내용 |
|---|---|
| 입력 | 5스텝 위저드 (하객·보증인원 / 식대 / 대관·꽃·주류 / 필수옵션 / 부가세·할인·축의금) |
| 계산 | 청구인원 · 1인당 실질단가 · 허수인원 · 허수 비용 · 순수 부담액 |
| 결과 | 항목별 내역, 좌석도로 시각화한 허수인원, 계산 가정 전체 공개 |
| 비교 | 최대 3개 홀, 1인당 실질단가 최저 자동 표시, 차액 표기 |
| 공유 | 결과 텍스트 복사 · 결과 이미지(1080×1350) 저장 · Web Share(카카오톡 등) |
| 지속 | 입력값·비교함 `localStorage` 자동 저장, 새로고침해도 유지 |
| 편의 | 2·3번째 홀 입력 시 하객·축의금 등 공통값 자동 프리필 |

## 계산 산식

부가세율은 10% 고정입니다.

**청구인원** — 식대와 주류가 붙는 인원
```
통합보증 : MAX(총 보증인원, 총 예상참석)
각 보증  : MAX(신랑 보증, 신랑 참석) + MAX(신부 보증, 신부 참석)
```

**총 예상비용**
```
식대     = (성인단가 × 청구인원 + 아동단가 × 아동수) × 식대VAT배수
식대 외  = (대관 + 꽃 + 폐백·진행·주차 + 주류단가 × 청구인원 + 필수옵션) × 기타VAT배수
총 예상비용 = 식대 + 식대 외 − 할인·지원        (0 미만이면 0)
```

**나머지 지표**
```
1인당 실질단가 = 총 예상비용 ÷ 실제 참석인원(성인 + 아동)
허수인원       = 청구인원 − 실제 참석 성인
허수 비용      = 허수인원 × (성인 식대 단가 + 주류 1인당 단가)   ※ 둘 다 VAT 반영 후
예상 축의금    = 1인 평균 × 실제 참석 성인
순수 부담액    = 총 예상비용 − 예상 축의금
```

### 기획서에서 미확정이던 항목을 어떻게 정했는지

원 기획서 1-5에 남아 있던 두 가지 모호함은 아래로 확정하고, 결과 화면의 **"이 계산이 세운 가정 보기"** 에 그대로 노출합니다.

- **허수 비용에 무엇이 들어가는가** → 식대 단가 + 주류 1인당 단가. 둘 다 청구인원에 곱해지는 항목이므로 함께 버려집니다.
- **축의금 인원 기준** → 청구인원이 아니라 **실제 참석 성인**. 오지 않은 사람이 축의금을 낸다고 가정하면 부담액이 과소평가됩니다.

추가로 **아동 식대는 청구인원과 별개로 추가 합산**합니다(보증인원은 성인 기준이라는 전제). 계약서상 아동이 보증인원에 포함된다면 아동 항목을 비우고 성인 인원에 넣으면 됩니다.

## 실행

빌드가 필요 없습니다. 정적 서버로 열기만 하면 됩니다.

```bash
npx serve .
```

Node가 없다면 Windows PowerShell만으로도 됩니다.

```bash
powershell -NoProfile -Command "$l=New-Object System.Net.HttpListener;$l.Prefixes.Add('http://localhost:8765/');$l.Start();Start-Process 'http://localhost:8765/index.html';while($l.IsListening){$c=$l.GetContext();$p=[System.Uri]::UnescapeDataString($c.Request.Url.AbsolutePath).TrimStart('/');if(!$p){$p='index.html'};$f=Join-Path (Get-Location) $p;if(Test-Path $f -PathType Leaf){$b=[IO.File]::ReadAllBytes($f);$c.Response.ContentLength64=$b.Length;$c.Response.OutputStream.Write($b,0,$b.Length)}else{$c.Response.StatusCode=404};$c.Response.Close()}"
```

`index.html` 을 브라우저로 직접 열어도 동작하지만(모듈 없이 클래식 스크립트만 씁니다), `file://` 에서는 브라우저에 따라 `localStorage` 와 클립보드가 막힐 수 있습니다.

## 배포 — GitHub Pages

1. `main` 브랜치에 푸시
2. 저장소 **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**
3. `https://aimbrige-netizen.github.io/weddinghall/` 에서 확인

## 구조

```
index.html          마크업 · 아이콘 스프라이트 · 방향 계약 주석
css/styles.css      전체 스타일 (토큰 → 컴포넌트 → 반응형 → 인쇄)
js/config.js        브랜드 · CTA · 예시값 · 필드 정의 · 로고 패스
js/format.js        숫자 포맷 · 입력 마스킹(커서 보존)
js/calc.js          계산 엔진 (순수 함수, DOM 무의존)
js/store.js         상태 · localStorage · 비교함
js/share.js         텍스트 복사 · Canvas 결과 이미지 · Web Share
js/app.js           위저드 · 결과 · 비교함 렌더링과 이벤트
assets/             로고 · 파비콘
견적서.md            원 기획서
PRODUCT.md          제품 진실 (변하지 않는 것)
DESIGN.md           시각 시스템 (토큰 · 타이포 · 모션 규칙)
```

## 커스터마이징

전부 [`js/config.js`](js/config.js) 한 곳에서 바꿉니다.

```js
CONFIG.cta.url     = 'https://...'; // 실제 Sding 상담/랜딩 주소
CONFIG.cta.enabled = true;          // 위 주소를 넣은 뒤 켜면 결과 하단에 리드 CTA 노출
CONFIG.MAX_COMPARE = 3;             // 비교함 개수
CONFIG.example     = { ... };       // 프리필 예시값
```

리드 CTA는 **기본값이 꺼짐**입니다. `url` 이 비어 있으면 `enabled` 와 무관하게 렌더되지 않으므로, 잘못된 주소로 링크가 나가는 일은 없습니다.

## 브라우저 지원

Chrome · Safari · Edge · Firefox 최신 2개 버전. iOS Safari 15+, Android Chrome.
`Web Share`, `navigator.clipboard`, `:has()` 미지원 환경은 각각 다운로드 / `execCommand` / 기본 레이아웃으로 자동 강등됩니다.

## 접근성

WCAG AA 기준으로 맞췄습니다. 본문 대비 4.5:1 이상, 터치 타겟 48px 이상, 모든 입력에 보이는 라벨,
색만으로 정보를 전달하지 않음(허수 좌석은 색이 아니라 **채움/비움**으로 구분), `prefers-reduced-motion` 대응,
`:focus-visible` 링 전면 적용, 브라우저 뒤로가기로 이전 단계 복귀.

---

계산 결과는 참고용입니다. 최종 금액과 조건은 반드시 계약서 원문으로 확인하세요.
