# Physics Arc 3D

GitHub Pages에서 실행할 수 있는 정적 Three.js 3D 물리 퍼즐 게임입니다.

## 실행
1. 저장소의 최상위에 `index.html`, `style.css`, `game.js`와 `js/`, `assets/`를 업로드합니다.
2. GitHub → Settings → Pages → Deploy from a branch → `main` / `/ (root)`를 선택합니다.
3. 저장 후 제공되는 Pages 주소에서 실행합니다.

## 조작
- 마우스 드래그: 카메라/조준
- 휠: 줌
- SPACE: 발사
- R: 현재 레벨 재시작
- CAMERA 버튼: 자유 / 공 추적 / 전체 보기

## 구현
- 3D 벡터 위치와 속도
- 중력 기반 포물선 운동
- 3D 예측 궤적
- 링 통과 판정
- 경계 반사
- 플랫폼, 스위치, 포털, 중력 구역
- 10개 레벨 구조
- 파티클 및 Web Audio 효과음
- 반응형 UI

## 폴더 구조
```text
smart3d/
├── index.html
├── style.css
├── game.js
├── .gitignore
├── README.md
├── js/
│   ├── README.md
│   └── .gitkeep
└── assets/
    ├── sounds/.gitkeep
    ├── models/.gitkeep
    └── textures/.gitkeep
```

현재 핵심 로직은 GitHub Pages에서 단순하게 배포할 수 있도록 `game.js` 하나에 통합되어 있습니다. `js/`와 `assets/`는 향후 물리/카메라/이펙트 코드 및 외부 에셋을 분리할 때 사용할 수 있습니다.

## 주의
Three.js는 jsDelivr CDN의 고정 버전을 사용합니다. 인터넷 연결이 필요한 GitHub Pages 배포 방식입니다.
