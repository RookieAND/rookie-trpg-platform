# 시나리오 파일 형식

`pnpm import:scenario <시나리오.json>`이 읽는 파일이에요. 가져오면 룸 하나가 만들어지고, 가져온 사람이 그 룸의 KP가 돼요. 실제 시나리오 파일은 저장소에 넣지 않아요.

```
pnpm import:scenario ./my-scenario/scenario.json [--user 이름] [--api http://localhost:8787] [--room 룸이름]
```

- 서버가 켜져 있어야 해요. 개발용 로그인에서는 `--user` 이름이 곧 신원이라, 같은 이름으로 로비에 들어가면 "내 룸"에 보여요.
- 룸을 만들기 전에 파일 전체를 먼저 검사해요. 문제가 하나라도 있으면 목록을 보여 주고 룸을 만들지 않아요.

## 최상위 필드

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `format` | 예 | 항상 `"roll-and-call-scenario"` |
| `version` | 예 | 항상 `1` |
| `roomName` | 예 | 룸 이름. `--room`이 있으면 그 값이 우선해요 |
| `scenes` | 예 | 장면 목록(1개 이상) |
| `tokens` | 예 | 소품·NPC 토큰 목록(비어도 돼요) |
| `characters` | 예 | NPC 시트 목록(비어도 돼요) |
| `handouts` | 예 | 핸드아웃 목록(비어도 돼요) |
| `beats` | 예 | 세션 흐름의 비트(최대 40개) |
| `branches` | 예 | 비트 사이의 분기(최대 80개) |
| `madnessTable` | 아니요 | 광기 증상표 |
| `audio` | 아니요 | 음원 목록 |

`key`는 파일 안에서 서로를 가리키는 이름표예요. 룸에는 저장되지 않아요.

## scenes

| 필드 | 설명 |
| --- | --- |
| `key` | 이 파일 안에서 쓰는 이름표 |
| `name` | 장면 이름 |
| `start` | `true`면 시작 장면 (선택) |
| `bgm` | 장면에 들어갈 때 틀 배경음의 `audio` key (선택, `kind`가 `bgm`이어야 해요) |

## tokens

`scene`(장면 key), `kind`(`"token"` 또는 `"prop"`), `name`, `x`, `y`, `layer`(`"background"`, `"object"`, `"gm"`), `visibleTo`(`"all"` 또는 `"gm"`).

## characters

`name`, `age`, `occupation`, `characteristics`(STR, CON, SIZ, DEX, APP, INT, POW, EDU 여덟 개 모두), `skills`(`{ name, value }` 목록), 선택으로 `hp`, `san`, `notes`, `backstory`. 적지 않은 기술과 수치는 기본값으로 채워져요.

## handouts

`key`, `title`, `body`, `visibleTo`(`"all"` 또는 `"gm"`). 제목이 `[KP]`로 시작하면 "KP 전용 노트"로 만들어져요. 노트는 PL에게 공개하거나 비트·분기 조건에 붙일 수 없어요.

## beats

| 필드 | 설명 |
| --- | --- |
| `key` | 이름표 |
| `name` | 비트 이름(40자까지) |
| `kind` | `"start"`, `"progress"`, `"ending"` |
| `scene` | 연결할 장면 key (선택) |
| `handouts` | 연결할 핸드아웃 key 목록(최대 10개, 비어도 돼요) |
| `memo` | KP 메모(1000자까지) |
| `sanReward` | 정신력 보상 식, 예: `"1d3"` (선택) |
| `bgm` | 비트로 넘어갈 때 틀 배경음의 `audio` key (선택) |

## branches

`from`, `to`(비트 key), `label`. 가져온 분기는 모두 KP가 직접 고르는 분기예요.

## madnessTable

문자열 목록이에요. 룸의 광기 증상표로 들어가요.

- 최대 10줄, 한 줄 120자까지(앞뒤 공백은 지워요), 빈 줄은 안 돼요.
- 없으면 룸의 증상표는 비어 있어요.

## audio

음원 목록이에요. 룸의 음원 라이브러리에 들어가고, 장면·비트의 `bgm`으로 연결해요.

| 필드 | 설명 |
| --- | --- |
| `key` | 이름표(영문·숫자·`-`·`_`, 40자까지, 겹치면 안 돼요) |
| `label` | 라이브러리에 보일 이름(1~40자) |
| `kind` | `"bgm"`(배경음) 또는 `"se"`(효과음) |
| `file` | 오디오 파일 경로. **시나리오 JSON이 있는 폴더 기준 상대 경로**예요 |

한도(서버와 같아요):

- 형식은 MP3, OGG, WAV, M4A. 확장자가 아니라 파일 내용으로 확인해요.
- 파일 하나에 10MB까지, 음원은 30개까지.
- 절대 경로와 폴더 바깥(`..`) 경로는 안 돼요.
- 업로드는 사람당 시간당 30개 제한이 있어요. 연달아 여러 번 가져오면 걸릴 수 있어요.

동작 순서:

1. 파일 존재·크기·형식과 `bgm` 참조를 모두 검사해요. 하나라도 틀리면 여기서 멈춰요.
2. 오디오 파일을 `POST /audio`로 올려요.
3. 룸을 만들고 광기표와 음원 라이브러리를 채워요.
4. 장면은 `scene.setBgm`, 비트는 `bgmTrackId`로 배경음을 연결해요.

효과음(`se`)은 라이브러리에만 들어가고, `bgm`으로는 연결할 수 없어요.

## 가짜 예시

```json
{
  "format": "roll-and-call-scenario",
  "version": 1,
  "roomName": "예시 시나리오",
  "scenes": [
    { "key": "hall", "name": "현관", "start": true, "bgm": "calm" },
    { "key": "cellar", "name": "지하실" }
  ],
  "tokens": [
    { "scene": "hall", "kind": "prop", "name": "낡은 상자", "x": 300, "y": 200, "layer": "object", "visibleTo": "all" }
  ],
  "characters": [
    {
      "name": "관리인",
      "age": 52,
      "occupation": "관리인",
      "characteristics": { "STR": 50, "CON": 55, "SIZ": 60, "DEX": 45, "APP": 40, "INT": 60, "POW": 50, "EDU": 55 },
      "skills": [{ "name": "듣기", "value": 60 }]
    }
  ],
  "handouts": [
    { "key": "note", "title": "찢어진 쪽지", "body": "지하실 열쇠는 상자 안에.", "visibleTo": "all" },
    { "key": "secret", "title": "[KP] 관리인의 비밀", "body": "관리인은 사실...", "visibleTo": "gm" }
  ],
  "beats": [
    { "key": "b1", "name": "도착", "kind": "start", "scene": "hall", "handouts": ["note"], "memo": "분위기를 잡아요.", "bgm": "calm" },
    { "key": "b2", "name": "지하실", "kind": "progress", "scene": "cellar", "handouts": [], "memo": "", "sanReward": "1d3", "bgm": "tense" }
  ],
  "branches": [{ "from": "b1", "to": "b2", "label": "지하실로 내려가요" }],
  "madnessTable": ["공포에 질려 도망쳐요", "아무 말도 못 하고 굳어요"],
  "audio": [
    { "key": "calm", "label": "잔잔한 곡", "kind": "bgm", "file": "audio/calm.mp3" },
    { "key": "tense", "label": "긴장되는 곡", "kind": "bgm", "file": "audio/tense.ogg" },
    { "key": "door", "label": "문 여는 소리", "kind": "se", "file": "audio/door.wav" }
  ]
}
```
