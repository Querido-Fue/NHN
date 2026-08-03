# Data Directory

엔진 전역에서 공유하는 정적 값(튜닝값, 레이아웃 비율, 프리셋, 경로)은 `data`에 모읍니다.

## Access Pattern

모듈에서는 개별 파일을 직접 import하지 않고 `data/data_handler.js`의 `getData(key)`를 사용합니다.

예시:

```js
import { getData } from 'data/data_handler.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
```

## Folder Guide

- `global/`: 전역 공통 상수
- `theme/`: 테마 컬러 스킴 (`light_theme.js`, `dark_theme.js`) 및 레지스트리(`theme_registry.js`)
- `overlay/`: 오버레이 공통 데이터(애니메이션 프리셋, 레이아웃 비율)
- `sound/`: 사운드 경로 및 기본 볼륨/입력 이벤트 상수
- `display/`: 렌더러(WebGL) 관련 고정 상수
- `input/`: 마우스/키보드 입력 상태 상수
- `simulation/`: 고정 스텝/명령 큐 런타임 기본값
- `debug/`: 성능 표시와 디버그 출력 상수
- `ui/layout/`: 버튼/패널 등 레이아웃 관련 상수
- `ui/typography/`: 텍스트 프리셋 상수
- `ui/cursor/`: 커서 전용 상수
- `ui/tooltip/`: 툴팁 레이아웃 상수
