# 시나리오·백업 파일 형식

룸을 준비하는 JSON 파일이에요. 세 곳에서 같은 파서로 읽어요.

- **웹 > 룸 > 설정 > 시나리오 가져오기** (GM): 파일을 고르거나 글을 붙여 넣으면 만들어질 것을 미리 보여 주고, 확인하면 지금 룸에 더해요. 전부 들어가거나 하나도 안 들어가요. 가져온 직후에는 **되돌리기**로 방금 가져온 것을 모두 지울 수 있어요.
- **웹 > 로비 > 백업에서 새 룸 만들기**: 파일 하나로 새 룸을 만들어요. 시나리오 파일도, 백업 파일도 돼요.
- **CLI**: `pnpm import:scenario <파일>`이 새 룸을 만들고 파일을 채워요(개발·운영 어디서든 쓸 수 있어요).

```
pnpm import:scenario ./my-scenario/scenario.json [--user 이름 | --token 로그인토큰] [--api http://localhost:8787] [--room 룸이름]
```

- 서버가 켜져 있어야 해요. 개발용 로그인에서는 `--user` 이름이 곧 신원이라 같은 이름으로 로비에 들어가면 "내 룸"에 보여요. 디스코드 로그인을 쓰는 서버에는 `--token`에 로그인 토큰(Bearer)을 넘겨요.
- 룸을 만들기 전에 파일 전체를 검사해요. 문제가 하나라도 있으면 목록을 보여 주고 룸을 만들지 않아요.
- "예시 받기"로 받는 파일과 이 문서 맨 아래의 예시는 같은 내용이에요.

## 내보내기

룸 설정에서 지금 룸을 파일로 받을 수 있어요(GM, 룸 주인).

| 메뉴 | 파일 | 담기는 것 |
| --- | --- | --- |
| 룸 백업 받기 | 백업(`roll-and-call-backup`) | 장면(배경·안개·배경음), 토큰·소품, 핸드아웃(GM 전용 노트 포함), 비트·분기, 음원 목록, 광기표, 판정 효과 설정, 이미지. "시트 포함"을 켜면 NPC·PC 시트도 |
| 시나리오 파일로 내보내기 | 시나리오(`roll-and-call-scenario`) | 위와 같지만 판정 효과 설정은 빼요 |

담기지 않는 것: 디스코드 웹훅 주소, 초대 링크, 접속한 사람의 이름·id, 굴림 기록, 진행 중인 전투 순서, 세션 번호. 토큰의 주인과 핸드아웃의 공개 대상은 사람 이름이 아니라 **그 PL의 캐릭터 이름**(시트가 없으면 `PL1`, `PL2` 같은 순번)으로 적혀요. 음원은 파일을 담지 않고 id만 적어요(그 서버에 파일이 남아 있을 때만 다시 쓸 수 있어요).

백업을 가져오면 PL의 캐릭터였던 시트(`pc: true`)는 **GM 몫의 시트**로 들어와요. 새 룸에는 아직 PL이 없기 때문이에요.

## 최상위 필드

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `format` | 예 | `"roll-and-call-scenario"` 또는 `"roll-and-call-backup"` |
| `version` | 예 | 시나리오는 `1`~`3`, 백업은 `1`·`2`. 더 큰 번호는 읽지 않아요. 토큰 표식(`markers`)을 담은 파일은 시나리오 3, 백업 2예요 |
| `roomName` | 예 | 룸 이름(60자까지). 새 룸을 만들 때 쓰고, 웹의 가져오기·`--room`으로 바꿀 수 있어요 |
| `scenes` | 예 | 장면 목록(1~30개) |
| `tokens` | 아니요 | 소품·토큰 목록(합쳐서 500개까지) |
| `characters` | 아니요 | NPC 시트 목록 |
| `handouts` | 아니요 | 핸드아웃 목록 |
| `beats` | 아니요 | 세션 흐름의 비트(최대 40개) |
| `branches` | 아니요 | 비트 사이의 분기(최대 80개) |
| `madnessTable` | 아니요 | 광기 증상표 |
| `audio` | 아니요 | 음원 목록 |
| `effects` | 아니요 | 판정 효과 설정(백업). 새 룸에만 적용해요 |
| `media` | 아니요 | 백업이 품은 이미지: 이미지 id → 데이터 주소 |
| `exportedAt` | 아니요 | 내보낸 시각(안내용) |

**버전 2는 버전 1에 선택 필드를 더하기만 했어요.** 버전 1 파일은 그대로 읽혀요. 빠진 목록은 비어 있는 것으로 보고, `visibleTo`가 빠진 핸드아웃은 GM 전용 초안이에요.

`key`는 파일 안에서 서로를 가리키는 이름표예요(영문·숫자·`-`·`_`, 40자까지, 같은 목록 안에서 겹치면 안 돼요). 룸에는 저장되지 않고, 가져올 때 모든 것이 **새 id**를 받아요. 파일에 id가 있어도 그대로 믿지 않아요.

## 이미지와 음원을 가리키는 법

`background`(장면), `image`(토큰·소품·핸드아웃)에는 글 하나를 적어요. 세 가지 중 하나예요.

1. **올려 둔 이미지의 id**(32자리 16진수): 이 룸에서 이미 쓴 이미지를 다시 쓸 때요.
2. **데이터 주소**(`data:image/png;base64,...`): 서버가 크기(3MB)와 형식(PNG·JPG·GIF·WEBP)을 확인해 새로 저장해요.
3. **파일 경로**: CLI에서만 써요(JSON이 있는 폴더 기준 상대 경로). 웹에서는 쓸 수 없어서 그 이미지는 건너뛰고 경고해요.

쓸 수 없는 이미지(없는 id, 틀린 형식, 너무 큰 파일)는 파일 전체를 막지 않고 **그 이미지만 건너뛰고** 미리보기에 경고로 알려요. 한 파일에 품을 수 있는 데이터 주소는 80개, 합쳐서 9MB까지예요.

## scenes

| 필드 | 설명 |
| --- | --- |
| `key` | 이 파일 안에서 쓰는 이름표 |
| `name` | 장면 이름(40자까지) |
| `start` | `true`면 시작 장면(선택). 룸에 이미 시작 장면이 있으면 지정하지 않고 경고해요 |
| `background` | 배경 이미지(위의 "이미지를 가리키는 법") |
| `bgm` | 장면에 들어갈 때 틀 배경음의 `audio` key. `"__stop__"`이면 음악을 멈춰요 |
| `fog` | 안개 설정 `{ "enabled": true, "zones": [{ "x": 500, "y": 400, "r": 160 }] }`. `zones`는 처음부터 밝혀 둘 영역(최대 60개, 반지름 10~600) |

지금 룸이 새 룸처럼 비어 있으면(장면 하나, 아무것도 꾸미지 않음) 그 첫 장면을 비우고 파일의 첫 장면으로 써요. 그래서 빈 "장면 1"이 남지 않아요.

## tokens

| 필드 | 설명 |
| --- | --- |
| `scene` | 놓을 장면의 key |
| `kind` | `"token"` 또는 `"prop"` |
| `name` | 이름(40자까지) |
| `x`, `y` | 보드 위치(보드는 1000 × 800) |
| `layer` | `"background"`, `"object"`(기본), `"gm"` |
| `visibleTo` | `"all"`(기본) 또는 `"gm"` |
| `owner` | 움직일 수 있는 PL. 룸의 PL 이름, 그 PL의 캐릭터 이름, 또는 `PL1`·`PL2` 같은 순번. 비우면 소유자 없음(NPC). 못 찾으면 NPC로 놓고 경고해요 |
| `image` | 토큰 그림 |
| `vision` | 시야 반지름(안개가 켜진 장면에서 쓰여요) |
| `character` | 이어 둘 시트의 `key`(`characters`). 토큰 아래에 HP 막대가 붙어요 |
| `hpPublic` | `true`면 PL에게도 이 토큰의 HP 막대를 보여 줘요(NPC용) |
| `locked` | `true`면 소유자도 못 움직여요 |
| `markers` | 토큰에 붙인 상태 표식 목록. 한 개는 `{ "key": "stun", "secret": true, "text": "…" }`예요. `key`는 `stun`(기절) `poison`(중독) `bleed`(출혈) `fear`(공포) `madness`(광기) `hidden`(은신) `focus`(집중) `help`(도움 필요) `dead`(사망) `custom`(사용자 지정, `text` 8자까지 필수). `secret: true`면 GM에게만 보여요. 토큰(`kind: "token"`)에만 쓰고, 한 토큰에 10개까지예요. 모르는 `key`는 그대로 두고 일반 표식으로 그려요 |

## characters

GM 몫의 시트(NPC)로 만들어져요. 필수는 `name`, `age`(15~90), `characteristics`(STR, CON, SIZ, DEX, APP, INT, POW, EDU 여덟 개 모두)뿐이에요.

| 필드 | 설명 |
| --- | --- |
| `key` | 토큰의 `character`가 가리키는 이름표(선택) |
| `occupation` | 직업(선택) |
| `skills` | `{ "name", "value", "grown"? }` 목록. 적지 않은 기능은 7판 기본값으로 채워져요 |
| `weapons` | `{ "name", "skill", "damage" }` 목록(12개까지). 예: `{ "name": "부지깽이", "skill": "맨손 격투", "damage": "1d6+db" }` |
| `luck`, `hp`, `mp`, `san` | 선택. 비우면 특성치로 계산해요(`luck`은 0) |
| `notes`, `backstory`, `possessions` | 글(선택) |
| `pc` | 백업에서 PL의 캐릭터였던 시트의 표시(가져오면 GM 몫이 돼요) |

## handouts

| 필드 | 설명 |
| --- | --- |
| `key` | 이름표 |
| `title`, `body` | 제목(60자까지)과 본문(4000자까지) |
| `visibleTo` | `"all"` 또는 `"gm"`(기본, 초안) |
| `to` | 보여 줄 PL 목록. 토큰의 `owner`와 같은 방식으로 찾아요. 있으면 `visibleTo`보다 우선하고, 하나도 못 찾으면 GM 전용으로 두고 경고해요 |
| `image` | 핸드아웃 그림 |
| `kpOnly` | `true`면 GM 전용 노트 |

제목이 `[KP]`(또는 `[GM]`)로 시작해도 "GM 전용 노트"로 만들어지고, 화면에 보이는 제목에서는 이 머리말을 떼요. 노트는 PL에게 공개하거나 비트·분기 조건에 붙일 수 없어요.

## beats

| 필드 | 설명 |
| --- | --- |
| `key` | 이름표 |
| `name` | 비트 이름(40자까지) |
| `kind` | `"start"`, `"progress"`, `"ending"`. 룸에 시작 비트가 이미 있으면 새 시작 비트는 진행 비트로 들어가요 |
| `scene` | 연결할 장면 key (선택) |
| `handouts` | 연결할 핸드아웃 key 목록(최대 10개, 비어도 돼요) |
| `memo` | GM 메모(1000자까지) |
| `sanReward` | 정신력 보상 식, 예: `"1d3"` (엔딩 비트에서만 쓰여요) |
| `bgm` | 비트로 넘어갈 때 틀 배경음의 `audio` key |

## branches

`from`, `to`(비트 key), `label`, 그리고 선택으로 `condition`. 조건을 적지 않으면 GM이 직접 고르는 분기예요. 조건은 다음 중 하나예요.

- `{ "type": "manual" }`
- `{ "type": "roll", "skill": "도서관 이용", "atLeast": "hard" }`
- `{ "type": "stat", "stat": "san", "atMost": 20 }`
- `{ "type": "handout", "handout": "핸드아웃 key" }`

## madnessTable

문자열 목록이에요. 룸의 광기 증상표로 들어가요.

- 최대 10줄, 한 줄 120자까지(앞뒤 공백은 지워요), 빈 줄은 안 돼요.
- 룸에 증상표가 이미 있으면 건드리지 않고 경고해요.

## audio

음원 목록이에요. 룸의 음원 라이브러리에 들어가고, 장면·비트의 `bgm`으로 연결해요.

| 필드 | 설명 |
| --- | --- |
| `key` | 이름표 |
| `label` | 라이브러리에 보일 이름(1~40자) |
| `kind` | `"bgm"`(배경음) 또는 `"se"`(효과음) |
| `file` | **CLI 전용.** 오디오 파일 경로(JSON이 있는 폴더 기준 상대 경로). 웹에서는 건너뛰어요 |
| `assetId` | 이미 올려 둔 오디오 파일의 id. 백업이 이렇게 적어요 |
| `data` | 오디오 데이터 주소(`data:audio/mpeg;base64,...`) |
| `volume` | 기본 볼륨 0~100(선택) |

한도(서버와 같아요):

- 형식은 MP3, OGG, WAV, M4A. 확장자가 아니라 파일 내용으로 확인해요.
- 파일 하나에 10MB까지, 음원은 30개까지.
- 절대 경로와 폴더 바깥(`..`) 경로는 안 돼요(CLI).

효과음(`se`)은 라이브러리에만 들어가고, `bgm`으로는 연결할 수 없어요.

## 가져올 때 규칙

1. 파일 전체를 먼저 검사해요. **오류**(형식이 틀림, 이름표가 없음, 한도 초과)가 하나라도 있으면 아무것도 만들지 않아요. 미리보기에 항목마다 위치와 이유가 나와요.
2. **경고**(소유자를 못 찾음, 쓸 수 없는 이미지, 이미 있는 시작 장면 등)는 가져오는 것을 막지 않아요. 미리보기에서 확인하고 가져와요.
3. 지금 룸에 이미 있는 것은 그대로 두고 뒤에 더해요. 장면·토큰·시트·핸드아웃·음원·비트·분기의 합이 룸 한도를 넘으면 가져오지 않아요.
4. 가져오기를 되돌리면 그때 만들어진 것만 지워요(가져온 뒤에 직접 고친 내용도 함께 사라져요). 가져온 장면이 진행 중이면 되돌릴 수 없어요.
5. 웹에서는 룸 주인(GM)만 할 수 있어요. 한 사람이 한 시간에 20번까지 가져올 수 있어요.

## 예시

아래 파일은 "예시 받기"로 받는 파일과 같아요. 장면의 배경은 데이터 주소로, 시트·토큰·핸드아웃은 이름표로 이어져 있어요. `owner: "PL1"`과 `to: ["PL1"]`은 룸의 첫 번째 PL을 가리켜요.

```json
{
  "format": "roll-and-call-scenario",
  "version": 3,
  "roomName": "예시 시나리오",
  "scenes": [
    {
      "key": "hall",
      "name": "현관",
      "start": true,
      "background": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOQUbHCihiGlgQA4+0egdUUGOYAAAAASUVORK5CYII=",
      "fog": {
        "enabled": false,
        "zones": [
          {
            "x": 500,
            "y": 400,
            "r": 160
          }
        ]
      }
    },
    {
      "key": "cellar",
      "name": "지하실",
      "fog": {
        "enabled": true,
        "zones": []
      }
    }
  ],
  "tokens": [
    {
      "scene": "hall",
      "kind": "prop",
      "name": "낡은 상자",
      "x": 300,
      "y": 200,
      "layer": "object",
      "visibleTo": "all"
    },
    {
      "scene": "hall",
      "kind": "token",
      "name": "관리인",
      "x": 600,
      "y": 300,
      "layer": "object",
      "visibleTo": "all",
      "character": "keeper",
      "hpPublic": false
    },
    {
      "scene": "hall",
      "kind": "token",
      "name": "첫 번째 PL",
      "x": 500,
      "y": 600,
      "layer": "object",
      "visibleTo": "all",
      "owner": "PL1",
      "vision": 120
    },
    {
      "scene": "cellar",
      "kind": "prop",
      "name": "금 간 거울",
      "x": 200,
      "y": 200,
      "layer": "gm",
      "visibleTo": "gm"
    }
  ],
  "characters": [
    {
      "key": "keeper",
      "name": "관리인",
      "age": 52,
      "occupation": "관리인",
      "characteristics": {
        "STR": 50,
        "CON": 55,
        "SIZ": 60,
        "DEX": 45,
        "APP": 40,
        "INT": 60,
        "POW": 50,
        "EDU": 55
      },
      "luck": 40,
      "skills": [
        {
          "name": "듣기",
          "value": 60
        },
        {
          "name": "맨손 격투",
          "value": 50
        }
      ],
      "weapons": [
        {
          "name": "부지깽이",
          "skill": "맨손 격투",
          "damage": "1d6+db"
        }
      ],
      "notes": "수상한 열쇠를 갖고 있어요."
    }
  ],
  "handouts": [
    {
      "key": "note",
      "title": "찢어진 쪽지",
      "body": "지하실 열쇠는 상자 안에.",
      "visibleTo": "all"
    },
    {
      "key": "letter",
      "title": "첫 번째 PL에게 온 편지",
      "body": "당신만 읽을 수 있는 편지예요.",
      "to": [
        "PL1"
      ]
    },
    {
      "key": "secret",
      "title": "[KP] 관리인의 비밀",
      "body": "관리인은 사실...",
      "visibleTo": "gm"
    }
  ],
  "beats": [
    {
      "key": "b1",
      "name": "도착",
      "kind": "start",
      "scene": "hall",
      "handouts": [
        "note"
      ],
      "memo": "분위기를 잡아요."
    },
    {
      "key": "b2",
      "name": "지하실",
      "kind": "progress",
      "scene": "cellar",
      "handouts": [],
      "memo": "",
      "sanReward": "1d3"
    }
  ],
  "branches": [
    {
      "from": "b1",
      "to": "b2",
      "label": "지하실로 내려가요"
    }
  ],
  "madnessTable": [
    "공포에 질려 도망쳐요",
    "아무 말도 못 하고 굳어요"
  ]
}
```

CLI에서만 쓰는 음원 파일 경로는 이렇게 적어요.

```
"audio": [{ "key": "calm", "label": "잔잔한 곡", "kind": "bgm", "file": "audio/calm.mp3" }]
```
