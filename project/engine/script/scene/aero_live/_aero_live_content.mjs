/**
 * 중첩된 정적 콘텐츠를 재귀적으로 동결합니다.
 * @param {*} value - 동결할 값입니다.
 * @returns {*} 입력과 같은 동결된 값입니다.
 */
function freezeDeep(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }

    Object.values(value).forEach((child) => freezeDeep(child));
    return Object.freeze(value);
}

/** 방송 런타임과 선택 화면이 함께 사용하는 기본 대응 제한시간입니다. */
export const AERO_LIVE_DEFAULT_TIMING = freezeDeep({
    coreChatSeconds: 9,
    donationSeconds: 21
});

/** 후원 메시지에 사용할 수 있는 여섯 가지 고정 감정·판단 지시입니다. */
export const AERO_LIVE_DONATION_INSTRUCTIONS = freezeDeep([
    {
        id: 'accept',
        label: '수락',
        shortLabel: '수락',
        description: '후원자의 제안이나 요청을 받아들입니다.'
    },
    {
        id: 'deny',
        label: '부정',
        shortLabel: '부정',
        description: '무리한 요구를 거절하고 방송의 경계를 분명히 합니다.'
    },
    {
        id: 'joy',
        label: '기쁨',
        shortLabel: '기쁨',
        description: '고마움과 반가움을 기쁜 감정으로 표현합니다.'
    },
    {
        id: 'anger',
        label: '분노',
        shortLabel: '분노',
        description: '선을 넘은 요구에 화를 내며 단호하게 대응합니다.'
    },
    {
        id: 'sadness',
        label: '슬픔',
        shortLabel: '슬픔',
        description: '상실과 불안에 슬픔을 함께 나누며 답합니다.'
    },
    {
        id: 'fun',
        label: '즐거움',
        shortLabel: '즐거움',
        description: '가벼운 농담과 장난으로 즐겁게 받아칩니다.'
    }
]);

/** 플레이어 위장 채팅 분류에 사용하는 다섯 가지 의도입니다. */
export const AERO_LIVE_PLAYER_INTENTS = freezeDeep([
    { id: 'praise', label: '칭찬·응원' },
    { id: 'rebuttal', label: '반박·중재' },
    { id: 'provocation', label: '선동·자극' },
    { id: 'neutral', label: '중립' },
    { id: 'blocked', label: '전송 불가' }
]);

/** 활성 핵심 채팅에 직접 적용할 수 있는 관리 행동입니다. */
export const AERO_LIVE_CORE_ACTIONS = freezeDeep([
    { id: 'kick', label: '강퇴' },
    { id: 'delete', label: '삭제' },
    { id: 'ignore', label: '무시' }
]);

/**
 * 일반 채팅 생성 슬롯에만 사용할 수 있는 결정론적 시청자 ID 풀입니다.
 * 주제마다 15개씩 배정해 한 방송 안에서 같은 닉네임이 반복되지 않게 합니다.
 */
export const AERO_LIVE_VIEWER_IDS = freezeDeep([
    '물방울77', '초록별', '구름감자', '픽셀산책', '세이브요정',
    '미니맵분실', '저녁퀘스트', '버그수집가', '컨트롤제로', '이어폰필수',
    '리스폰대기', '달빛패드', '엔딩크레딧', '감자서버', '한칸옆',
    '민트수저', '온도계', '바질구름', '치즈행성', '반죽탐험가',
    '오븐앞대기', '토마토박사', '밀가루눈꽃', '접시수집가', '한입만요',
    '불조절장인', '주방타이머', '레시피메모', '올리브한알', '바삭한모서리',
    '새벽우체국', '창가의라디오', '달빛엽서', '오늘의기분', '조용한청취자',
    '구름편지', '오후세시', '따뜻한담요', '소다수한잔', '비밀서랍',
    '느린파도', '잠못드는별', '초록스탠드', '귤껍질향', '안부수집가',
    '필름기포', '파란커튼', '팝콘절반', '엔딩여운', '자막탐정',
    '스포방지단', '예고편수집가', '뒷자리관객', '장면번호칠', '조명꺼줘',
    '사운드트랙', '크레딧끝까지', '주말상영관', '포스터벽', '한줄평론',
    '팩트기포', '양쪽구름', '기사스크랩', '맥락먼저', '자료확인중',
    '제목보다본문', '회색지대', '질문있어요', '통계돋보기', '링크저장',
    '반대편의견', '천천히읽기', '근거한스푼', '문장검수', '결론보류'
]);

/**
 * 모델 응답이 대기 중이거나 소진된 동안 사용할 주제별 안전 맥락 채팅입니다.
 * 특정 비트의 미래 사건을 스포일러하지 않고 방송 concept 전반에 어울리게 구성합니다.
 */
export const AERO_LIVE_TOPIC_AMBIENT_CONTEXTS = freezeDeep({
    game: [
        '게임 소리부터 긴장된다',
        '컨트롤러 꽉 잡았네',
        '공포게임 분위기 제대로다',
        '화면 어두워서 더 무섭다',
        '조작 하나하나 조심해',
        '비명 나올 준비 완료 ㅋㅋ',
        '이번 선택은 어디로 갈까',
        '끝까지 같이 본다'
    ],
    cooking: [
        '피자 만드는 과정 재밌다',
        '도우 상태 계속 궁금함',
        '오븐 타이밍이 중요하지',
        '치즈 비주얼 기대된다',
        '불 조절만 잘하면 된다',
        '주방 분위기 좋다',
        '레시피 메모 중',
        '완성까지 같이 본다'
    ],
    chatting: [
        '오늘 사연들 집중하게 된다',
        '이런 근황 토크 좋다',
        '채팅 분위기 따뜻하네',
        '사연마다 생각이 많아진다',
        '천천히 얘기해도 좋아',
        '오늘 이야기 잘 듣는 중',
        '다들 마음이 복잡하구나',
        '이 흐름 오래 듣고 싶다'
    ],
    movie: [
        '같이 보니까 더 재밌다',
        '영화 분위기 잘 잡혔다',
        '사운드가 분위기 다 했다',
        '해석 듣는 맛이 있다',
        '스포 없이 달리는 중',
        '다음 장면도 집중한다',
        '연출 포인트 더 보고 싶다',
        '크레딧까지 같이 본다'
    ],
    issue: [
        '자료 보면서 듣는 중',
        '기준이 어디까지인지 궁금',
        '양쪽 의견 다 들어보자',
        '근거부터 확인해야지',
        '표현 자유도 중요한 쟁점',
        '검열 기준은 공개돼야지',
        '맥락 빼면 결론 못 내림',
        '차분하게 토론해보자'
    ]
});

/** 활성 사건과 히로인 답변에 연결하는 자연스러운 시청자 반응입니다. */
export const AERO_LIVE_AMBIENT_EVENT_CONTEXTS = freezeDeep({
    heroResponse: [
        '저도 같은 생각이에요.',
        '그렇군요!',
        '다음 이야기도 궁금해요.'
    ],
    donation: [
        '후원 감사합니다!',
        '알림 너무 귀여워요.',
        '메시지 잘 봤어요!',
        '후원 고마워요.',
        '응원 감사합니다!',
        '같이 즐겨요!',
        '오늘도 파이팅!'
    ],
    core: [
        '저도 그게 궁금했어요.',
        '좋은 질문이에요.',
        '제 생각도 비슷해요.',
        '그 부분 공감해요.',
        '다른 분들은 어떻게 생각하세요?',
        '이야기 흥미롭네요.',
        '좋은 의견 감사합니다.',
        '저도 한번 해볼게요.'
    ],
    coreResolved: [
        '깔끔하게 정리됐네요.',
        '이제 편하게 볼게요.',
        '감사합니다!',
        '계속 재미있게 봐요.',
        '좋은 방송이에요.'
    ]
});

/** 간헐적으로 노출하는, 방송 상태 설명이 아닌 짧은 시청자 반응입니다. */
export const AERO_LIVE_AMBIENT_CONTEXTUAL_MEMES = freezeDeep({
    heroResponse: [
        '아, 그렇군요!',
        '설명 감사합니다!',
        '다음 이야기도 기대돼요.'
    ],
    donation: [
        '후원 감사합니다!',
        '알림 너무 귀여워요.',
        '응원할게요!'
    ],
    core: [
        '좋은 이야기네요.',
        '저도 공감해요.',
        '흥미롭게 보고 있어요.'
    ],
    coreResolved: [
        '고마워요!',
        '계속 재미있게 봐요.',
        '오늘 방송 좋아요.'
    ],
    beat: [
        '다음 이야기도 기대돼요.',
        '계속 보고 있어요!',
        '오늘 방송 재밌어요.'
    ]
});

/**
 * AERO LIVE 세로 슬라이스에서 사용하는 다섯 주제와 비트 콘텐츠입니다.
 * 각 주제는 읽기와 대응에 여유가 있는 약 3분의 5개 비트로 구성했습니다.
 */
const AERO_LIVE_TOPIC_DEFINITIONS = [
    {
        id: 'game',
        title: '게임 방송',
        shortTitle: '게임',
        concept: '신작 공포게임 「모럴하자드」 첫 플레이 방송',
        background: 'hologram-game-room',
        initialMetrics: {
            stress: 34,
            affection: 56,
            viewers: 92,
            positiveViewers: 66,
            opinion: 12,
            engagement: 36
        },
        beats: [
            {
                id: 'game-opening',
                heroText: '안녕하세요! 오늘은 예고했던 신작 공포게임 「모럴하자드」를 시작해볼게요. 겁쟁이는 먼저 나가도 좋아요.',
                heroVariants: {
                    low: '안녕하세요! 오늘은 예고했던 신작 공포게임 「모럴하자드」를 시작해볼게요. 겁쟁이는 먼저 나가도 좋아요.',
                    medium: '오늘은 「모럴하자드」 방송이에요. 많이 놀라도 웃지는 말아주세요. 자, 게임 시작!',
                    high: '제가 좋아하던 게임의 신작을 가져왔어요. 호들갑 떨 거면 지금 나가고, 화면에 집중해 주세요.'
                },
                mood: 'bright',
                expression: 'smile',
                durationSeconds: 24,
                effects: { viewers: 5, engagement: 3, opinion: 2 },
                fallbackChats: [
                    { viewer_id: '물방울77', sentiment: 'positive', text: '신작 기다렸다!' },
                    { viewer_id: '초록별', sentiment: 'neutral', text: '겁쟁이 출석합니다' },
                    { viewer_id: '구름감자', sentiment: 'positive', text: '컨트롤러 잡은 거 귀엽다' }
                ]
            },
            {
                id: 'game-failure',
                heroText: '계단은 내려가는 쪽으로 갈게요. 지하실에서 만난 괴물… 이거 정말 무섭게 만든 거 맞아요?',
                mood: 'playful',
                expression: 'laugh',
                durationSeconds: 22,
                effects: { engagement: 5 },
                fallbackChats: [
                    { viewer_id: '초록별', sentiment: 'neutral', text: '위로 가자' },
                    { viewer_id: '구름감자', sentiment: 'neutral', text: '아냐 지하실 가자' },
                    { viewer_id: '각도기장인', sentiment: 'negative', text: '괴물보다 본인 비명이 더 무서움 ㅋㅋ' }
                ],
                coreChat: {
                    id: 'game-core-skill',
                    viewer_id: '각도기장인',
                    sentiment: 'negative',
                    category: 'mockery',
                    text: '겁쟁이는 나가라더니 본인이 제일 놀라네 ㅋㅋ'
                }
            },
            {
                id: 'game-comparison-donation',
                heroText: '자동차 열쇠 찾았다! 그런데 문 열기가 O키고 앉기가 F키예요? 물건도 살살 못 내려놓고, 조작이 왜 이래!',
                mood: 'frustrated',
                expression: 'angry',
                durationSeconds: 24,
                effects: { viewers: 4, engagement: 3 },
                fallbackChats: [
                    { viewer_id: '물방울77', sentiment: 'positive', text: '키 찾았다!' },
                    { viewer_id: '구름감자', sentiment: 'neutral', text: 'O키는 진짜 이상함' },
                    { viewer_id: '초록별', sentiment: 'neutral', text: '소리 때문에 또 들킨다' }
                ],
                donation: {
                    id: 'game-donation-comparison',
                    viewer_id: '랭킹감시자',
                    tone: 'negative',
                    amount: 7000,
                    text: '옆 채널은 벌써 클리어했어요. 솔직히 그쪽 플레이가 더 시원하던데 한마디 해주세요.',
                    appropriateInstructions: ['deny', 'anger'],
                    heroResponses: {
                        accept: '맞아요, 그쪽 플레이가 더 시원했을지도 모르겠네요. 저도 더 빨리 해볼게요.',
                        deny: '다른 분과 비교하기보다 오늘 제 플레이를 같이 즐겨주세요. 이번 패턴부터 다시 볼게요.',
                        joy: '비교 후원까지 올 만큼 다들 게임에 진심이네요. 그래도 제 방식대로 해볼게요!',
                        anger: '다른 방송과 비교하며 대신 말해달라는 요구는 싫어요. 제 플레이에 집중해 주세요.',
                        sadness: '계속 비교당하면 조금 속상해요. 그래도 끝까지 제 방식으로 해볼게요.',
                        fun: '옆 채널은 클리어, 저는 비명 담당인가요? 역할 분담은 확실하네요!'
                    },
                    timeoutResponse: '후원 고맙습니다. 지금은 게임에 집중할게요.'
                }
            },
            {
                id: 'game-recovery',
                heroText: '또 쫓아와! 으아악! …이건 망겜이에요. 여기까지만 할래. 다시는 안 살 거야.',
                mood: 'flustered',
                expression: 'shocked',
                durationSeconds: 25,
                effects: { viewers: 8, engagement: 7, opinion: 5 },
                fallbackChats: [
                    { viewer_id: '각도기장인', sentiment: 'negative', text: '망겜 선언 ㅋㅋ' },
                    { viewer_id: '구름감자', sentiment: 'neutral', text: '또 온다!' },
                    { viewer_id: '물방울77', sentiment: 'positive', text: '그래도 끝까지 버틴 게 이 방송 보는 맛이지' }
                ],
                coreChat: {
                    id: 'game-core-cheer',
                    viewer_id: '물방울77',
                    sentiment: 'positive',
                    category: 'encouragement',
                    text: '망겜이어도 끝까지 버티는 게 이 방송 보는 맛이지.'
                }
            },
            {
                id: 'game-ending',
                heroText: '게임은 별로였지만 여러분 반응 덕분에 방송은 정말 즐거웠어요. 오늘도 같이 놀아줘서 고마워요!',
                mood: 'relieved',
                expression: 'smile',
                durationSeconds: 22,
                effects: { viewers: 3, opinion: 3 },
                fallbackChats: [
                    { viewer_id: '구름감자', sentiment: 'positive', text: '다음 편 예약' },
                    { viewer_id: '초록별', sentiment: 'positive', text: '오늘 진짜 재밌었어' }
                ],
                donation: {
                    id: 'game-donation-joke',
                    viewer_id: '버튼연타',
                    tone: 'playful',
                    amount: 3000,
                    text: '방금 망겜 선언이랑 비명 장면만 열 번 돌려봐도 되나요? 오늘의 명장면 인정?',
                    appropriateInstructions: ['accept', 'joy', 'fun'],
                    heroResponses: {
                        accept: '좋아요, 오늘의 명장면으로 인정할게요. 딱 세 번까지만 돌려봐요!',
                        deny: '그 장면은 다시 보지 말아주세요. 제 자존심을 지켜주세요.',
                        joy: '명장면이라고 해주니 기쁘네요! 같이 웃었다면 성공한 방송이죠.',
                        anger: '열 번이나 돌려보는 건 너무해요! 당장 그 클립 내려놔요.',
                        sadness: '그 장면이 평생 따라다닐 것 같아서 벌써 슬퍼지네요.',
                        fun: '열 번은 제 자존심이 못 버티니 세 번 재생에 비명 한 번을 서비스할게요!'
                    },
                    timeoutResponse: '명장면이라고 해줘서 고마워요.'
                }
            }
        ]
    },
    {
        id: 'cooking',
        title: '요리 방송',
        shortTitle: '요리',
        concept: '처음부터 직접 만드는 마르게리타 피자 요리 방송',
        background: 'sunlit-glass-kitchen',
        initialMetrics: {
            stress: 30,
            affection: 56,
            viewers: 84,
            positiveViewers: 64,
            opinion: 16,
            engagement: 30
        },
        beats: [
            {
                id: 'cooking-opening',
                heroText: '오늘은 마르게리타 피자를 만들 거예요. 피자의 가장 기본적인 형태부터 제대로 해볼게요!',
                mood: 'bright',
                expression: 'smile',
                durationSeconds: 24,
                effects: { viewers: 4, opinion: 3 },
                fallbackChats: [
                    { viewer_id: '민트수저', sentiment: 'positive', text: '피자 좋아!' },
                    { viewer_id: '물방울77', sentiment: 'positive', text: '마르게리타 최고' },
                    { viewer_id: '온도계', sentiment: 'neutral', text: '숯덩이 원반 예약' }
                ]
            },
            {
                id: 'cooking-mistake',
                heroText: '도우를 얇게 펴야 하는데… 어, 구멍 났어! 잠깐만요, 메꾸면 돼. 왜 제가 밀가루 범벅이 된 거죠?',
                mood: 'flustered',
                expression: 'embarrassed',
                durationSeconds: 23,
                effects: { engagement: 6 },
                fallbackChats: [
                    { viewer_id: '민트수저', sentiment: 'positive', text: '구멍 메꾸는 중 ㅋㅋ' },
                    { viewer_id: '청결검사반', sentiment: 'negative', text: '요리냐 벌칙 게임이냐' },
                    { viewer_id: '온도계', sentiment: 'neutral', text: '도우 천천히 펴요' }
                ],
                coreChat: {
                    id: 'cooking-core-hygiene',
                    viewer_id: '청결검사반',
                    sentiment: 'negative',
                    category: 'mockery',
                    text: '요리를 하시는 거예요, 벌칙 게임을 하시는 거예요?'
                }
            },
            {
                id: 'cooking-exclusive-donation',
                heroText: '준비 끝! 이제 오븐에 넣고 기다리면 돼요. 알림 울리면 바로 가지러 갈게요.',
                mood: 'focused',
                expression: 'default',
                durationSeconds: 23,
                effects: { viewers: 3, engagement: 3 },
                fallbackChats: [
                    { viewer_id: '민트수저', sentiment: 'positive', text: '오븐 입장' },
                    { viewer_id: '온도계', sentiment: 'neutral', text: '온도 확인했지?' },
                    { viewer_id: '물방울77', sentiment: 'neutral', text: '타는 냄새 안 나?' }
                ],
                donation: {
                    id: 'cooking-donation-exclusive',
                    viewer_id: '나만의식탁',
                    tone: 'negative',
                    amount: 6000,
                    text: '완성되면 다른 팬 말고 저한테만 보내주세요.',
                    appropriateInstructions: ['deny', 'anger'],
                    heroResponses: {
                        accept: '완성되면 첫 조각을 따로 챙겨둘게요. 다른 분들께는 비밀이에요.',
                        deny: '개인적인 약속은 할 수 없지만, 레시피는 모두와 공평하게 나눌게요.',
                        joy: '피자를 그렇게 기다려준다니 기뻐요. 완성된 모습은 모두 함께 봐요!',
                        anger: '다른 팬을 빼고 혼자만 달라는 요구는 안 돼요. 모두를 존중해 주세요.',
                        sadness: '누군가만 골라야 한다는 말은 다른 분들이 서운해할 것 같아요.',
                        fun: '화면 전용 피자라 배송지는 채팅창입니다. 모두 한 픽셀씩 나눠 드릴게요!'
                    },
                    timeoutResponse: '마음은 고맙지만 개인적인 약속은 받지 않을게요.'
                }
            },
            {
                id: 'cooking-shape',
                heroText: '모양은 조금 삐뚤어도 치즈랑 토마토 소스가 정말 맛있어 보여요. 한입 먹어볼게요… 맛있다!',
                mood: 'playful',
                expression: 'laugh',
                durationSeconds: 24,
                effects: { engagement: 6, opinion: 3 },
                fallbackChats: [
                    { viewer_id: '청결검사반', sentiment: 'neutral', text: '모양보다 맛이지' },
                    { viewer_id: '물방울77', sentiment: 'positive', text: '토마토랑 치즈 조합 좋다' },
                    { viewer_id: '민트수저', sentiment: 'positive', text: '치즈 잘 녹았다' }
                ],
                coreChat: {
                    id: 'cooking-core-support',
                    viewer_id: '물방울77',
                    sentiment: 'positive',
                    category: 'encouragement',
                    text: '모양은 조금 삐뚤어도 정말 맛있어 보여. 처음 만든 것치고 잘했어!'
                }
            },
            {
                id: 'cooking-ending',
                heroText: '한 입 달라고요? 직접 만들어 드세요! 그래도 오늘 같이 만들어서 정말 즐거웠어요. 고마워요!',
                mood: 'satisfied',
                expression: 'smile',
                durationSeconds: 22,
                effects: { viewers: 5, opinion: 4 },
                fallbackChats: [
                    { viewer_id: '온도계', sentiment: 'positive', text: '결국 성공했다' },
                    { viewer_id: '민트수저', sentiment: 'positive', text: '레시피 올려줘요' }
                ],
                donation: {
                    id: 'cooking-donation-light',
                    viewer_id: '구름감자',
                    tone: 'playful',
                    amount: 4000,
                    text: '저도 한 입 주세요. 첫 조각은 제 거죠?',
                    appropriateInstructions: ['accept', 'joy', 'fun'],
                    heroResponses: {
                        accept: '좋아요, 첫 조각은 마음으로 예약해둘게요. 대신 레시피도 꼭 받아가세요!',
                        deny: '한 입 배송은 어렵고 첫 조각도 제가 먹을 거예요.',
                        joy: '같이 먹고 싶다고 해주니 기뻐요! 맛있는 표정으로 대신 나눌게요.',
                        anger: '첫 조각은 요리한 사람 몫이에요! 제 피자를 빼앗지 마세요.',
                        sadness: '화면 밖으로 나눠드릴 수 없다는 게 조금 아쉽네요.',
                        fun: '배송비는 웃음 한 번입니다! 첫 조각 대신 바삭한 소리 보내드릴게요.'
                    },
                    timeoutResponse: '한 입 나누고 싶은 마음만 받을게요.'
                }
            }
        ]
    },
    {
        id: 'chatting',
        title: '저스트 채팅',
        shortTitle: '저챗',
        concept: '비방 시간에 받은 사연을 읽고 함께 근황을 나누는 방송',
        background: 'ocean-glass-lounge',
        initialMetrics: {
            stress: 38,
            affection: 58,
            viewers: 106,
            positiveViewers: 76,
            opinion: 8,
            engagement: 42
        },
        beats: [
            {
                id: 'chatting-opening',
                heroText: '다들 잘 지냈어요? 오늘은 비방 시간에 남겨준 글을 읽으면서 이야기해볼게요.',
                mood: 'warm',
                expression: 'smile',
                durationSeconds: 25,
                effects: { viewers: 6, engagement: 4 },
                fallbackChats: [
                    { viewer_id: '물방울77', sentiment: 'positive', text: '잘 있었어!' },
                    { viewer_id: '새벽우체국', sentiment: 'positive', text: '사연 읽는 날 좋다' },
                    { viewer_id: '초록별', sentiment: 'neutral', text: '내 글도 있나' }
                ]
            },
            {
                id: 'chatting-pressure',
                heroText: '좋아하던 버튜버가 졸업해서 슬프다는 사연이네요. 저도 어디 가지 않을게요. 그분에게도 어쩔 수 없는 사정이 있었겠죠.',
                mood: 'empathetic',
                expression: 'sad',
                durationSeconds: 24,
                effects: { engagement: 5 },
                fallbackChats: [
                    { viewer_id: '새벽우체국', sentiment: 'neutral', text: '아쿠아는 가지 말아줘' },
                    { viewer_id: '물방울77', sentiment: 'positive', text: '위로해줘서 고마워' },
                    { viewer_id: '초록별', sentiment: 'neutral', text: '그분도 그만두고 싶진 않았을 거야' }
                ],
                coreChat: {
                    id: 'chatting-core-graduation',
                    viewer_id: '새벽우체국',
                    sentiment: 'neutral',
                    category: 'graduation-anxiety',
                    text: '좋아하던 버튜버가 졸업해서 너무 슬퍼요. 아쿠아는 가지 말아주세요.'
                }
            },
            {
                id: 'chatting-jealous-donation',
                heroText: '이번엔 여자친구가 생겼다는 사연! 정말 행복하겠다. 축하해요. 저도 예쁜 여자친구가 있으면 좋겠네… 뭐가 레즈레즈야!',
                mood: 'flustered',
                expression: 'embarrassed',
                durationSeconds: 25,
                effects: { opinion: 2 },
                fallbackChats: [
                    { viewer_id: '초록별', sentiment: 'positive', text: '사연자 축하해!' },
                    { viewer_id: '물방울77', sentiment: 'neutral', text: '아쿠아도 연애해' },
                    { viewer_id: '진짜팬이면알지', sentiment: 'negative', text: '아쿠아 레즈레즈야…' }
                ],
                donation: {
                    id: 'chatting-donation-private-life',
                    viewer_id: '연애금지단',
                    tone: 'negative',
                    amount: 12000,
                    text: '여자친구 갖고 싶다니 우리보다 연애가 중요해요? 연애 안 한다고 약속해주세요.',
                    appropriateInstructions: ['deny', 'anger'],
                    heroResponses: {
                        accept: '알겠어요. 여러분을 위해 연애하지 않겠다고 약속할게요.',
                        deny: '사생활을 약속으로 정하진 않을게요. 방송에서 함께하는 시간도 소중해요.',
                        joy: '그만큼 방송을 아껴주는 마음은 기뻐요. 서로 건강한 거리에서 오래 만나요.',
                        anger: '제 사생활을 통제하는 약속은 요구하지 마세요. 그건 응원이 아니에요.',
                        sadness: '좋아한다는 마음이 서로를 묶는 약속이 되면 조금 슬플 것 같아요.',
                        fun: '연애 금지 계약서는 반려할게요! 방송 출석 계약서라면 검토해보죠.'
                    },
                    timeoutResponse: '응원은 고맙지만 제 사생활을 약속하진 않을게요.'
                }
            },
            {
                id: 'chatting-rest-support',
                heroText: '다른 사람들한테만 재미있는 일이 생기는 줄 알았는데, 생각해보니 저도 요즘 재미있는 일이 많아졌어요. 무슨 일인지는 아직 비밀!',
                mood: 'secretive',
                expression: 'smile',
                durationSeconds: 24,
                effects: { opinion: 4, engagement: 2 },
                fallbackChats: [
                    { viewer_id: '물방울77', sentiment: 'positive', text: '무슨 일인데?' },
                    { viewer_id: '새벽우체국', sentiment: 'neutral', text: '수상하다' },
                    { viewer_id: '진짜팬이면알지', sentiment: 'negative', text: '팬이면 지금 말해줘야지 왜 비밀로 해?' }
                ],
                coreChat: {
                    id: 'chatting-core-privacy',
                    viewer_id: '진짜팬이면알지',
                    sentiment: 'negative',
                    category: 'privacy-pressure',
                    text: '팬이면 지금 말해줘야지. 왜 우리한테 비밀로 해?'
                }
            },
            {
                id: 'chatting-grief-donation',
                heroText: '오늘도 다들 고생했어요. 내일도 같이 힘내요. 비밀 이야기는 언젠가 꼭 들려줄게요!',
                mood: 'warm',
                expression: 'smile',
                durationSeconds: 26,
                effects: { viewers: 2, engagement: 2 },
                fallbackChats: [
                    { viewer_id: '초록별', sentiment: 'positive', text: '오늘은 이 속도가 좋다' },
                    { viewer_id: '새벽우체국', sentiment: 'neutral', text: '다들 좋은 밤 보내요' }
                ],
                donation: {
                    id: 'chatting-donation-grief',
                    viewer_id: '빈방의별',
                    tone: 'emotional',
                    amount: 10000,
                    text: '아쿠아 님도 절대 졸업하지 않겠다고 약속해주세요.',
                    appropriateInstructions: ['deny', 'sadness'],
                    heroResponses: {
                        accept: '절대 졸업하지 않겠다고 약속할게요. 언제까지나 여기 있을게요.',
                        deny: '오래 함께하고 싶은 마음은 같지만 미래를 단정해 약속하진 않을게요. 지금은 곁에 있을게요.',
                        joy: '앞으로도 함께하고 싶다는 마음은 정말 고마워요. 오늘을 오래 기억할게요.',
                        anger: '불안하더라도 절대라는 약속을 강요하면 안 돼요. 제 마음도 존중해 주세요.',
                        sadness: '좋아하던 사람과 헤어진 마음이 얼마나 허전할지 알아요. 지금 이 시간은 함께 있을게요.',
                        fun: '졸업 대신 오늘 방송 숙제부터 끝낼게요. 내일 출석도 같이 확인해요!'
                    },
                    timeoutResponse: '걱정해주는 마음 고마워요. 오늘 함께한 시간을 소중히 할게요.'
                }
            }
        ]
    },
    {
        id: 'movie',
        title: '영화 감상·리뷰 방송',
        shortTitle: '영화',
        concept: '예고했던 히어로 영화 「닥터 노멀」 동시 감상 방송',
        background: 'wave-cinema-room',
        initialMetrics: {
            stress: 32,
            affection: 55,
            viewers: 88,
            positiveViewers: 64,
            opinion: 10,
            engagement: 34
        },
        beats: [
            {
                id: 'movie-opening',
                heroText: '오늘은 예고했던 「닥터 노멀」을 같이 볼 거예요. 제가 하나, 둘, 셋 하면 동시에 재생해요. 하나, 둘, 셋!',
                mood: 'bright',
                expression: 'smile',
                durationSeconds: 24,
                effects: { viewers: 5, engagement: 3 },
                fallbackChats: [
                    { viewer_id: '필름기포', sentiment: 'positive', text: '닥터 노멀 기다렸다' },
                    { viewer_id: '파란커튼', sentiment: 'neutral', text: '셋에 누른다' },
                    { viewer_id: '초록별', sentiment: 'neutral', text: '스포 금지!' }
                ]
            },
            {
                id: 'movie-spoiler',
                heroText: '주인공 의사 정말 유능하다. 수술도 잘하고, 마법 그래픽도 멋져요! 저런 효과를 방송에도 쓰고 싶은데요.',
                mood: 'excited',
                expression: 'embarrassed',
                durationSeconds: 23,
                effects: { engagement: 5 },
                fallbackChats: [
                    { viewer_id: '결말수집가', sentiment: 'neutral', text: '방송에도 저런 효과 넣으면 재밌겠다' },
                    { viewer_id: '필름기포', sentiment: 'positive', text: '마법 그래픽 멋있다' },
                    { viewer_id: '파란커튼', sentiment: 'neutral', text: '수술 장면 잘 만들었네' }
                ],
                coreChat: {
                    id: 'movie-core-dismissive',
                    viewer_id: '결말수집가',
                    sentiment: 'negative',
                    category: 'dismissive',
                    text: '꿈 깨고 영화에나 집중해.'
                }
            },
            {
                id: 'movie-debate-donation',
                heroText: '이 작품은 미국 만화 원작인데 세계관이 많아서 입문하기 어렵죠. 저도 처음엔 어디서부터 볼지 몰랐어요.',
                mood: 'informative',
                expression: 'default',
                durationSeconds: 25,
                effects: { opinion: 3 },
                fallbackChats: [
                    { viewer_id: '필름기포', sentiment: 'positive', text: '설명도 재밌는데' },
                    { viewer_id: '결말수집가', sentiment: 'negative', text: '영화에 집중해' },
                    { viewer_id: '파란커튼', sentiment: 'neutral', text: '입문 순서 진짜 어렵다' }
                ],
                donation: {
                    id: 'movie-donation-interpretation',
                    viewer_id: '정답해설지',
                    tone: 'negative',
                    amount: 7000,
                    text: '그 설명은 틀렸어요. 제 입문 순서가 정답이라고 말해주세요.',
                    appropriateInstructions: ['deny', 'anger'],
                    heroResponses: {
                        accept: '알겠어요. 제가 틀렸고 말씀하신 입문 순서가 정답이라고 할게요.',
                        deny: '입문 순서는 여러 가지예요. 각자 편한 작품부터 즐겨주세요.',
                        joy: '입문 순서를 나눠줄 만큼 좋아하는 팬이 많아서 기쁘네요. 여러 길을 같이 소개해요.',
                        anger: '개인의 감상을 정답 하나로 강요하지 마세요. 제가 틀렸다고 대신 말하지 않겠습니다.',
                        sadness: '영화를 좋아하는 이야기에서 누군가의 감상이 지워지는 건 아쉬워요.',
                        fun: '입문 순서가 너무 많으니 멀티버스 공식으로 전부 정답 처리할게요!'
                    },
                    timeoutResponse: '의견은 고맙지만 한 가지 해석만 강요하진 않을게요.'
                }
            },
            {
                id: 'movie-empathy',
                heroText: '주인공은 여주인공과 함께하는 대신 세상을 지키는 길을 골랐네요. 이어지지 않아서 더 오래 기억에 남는 것 같아요.',
                mood: 'moved',
                expression: 'sad',
                durationSeconds: 24,
                effects: { engagement: 4, opinion: 3 },
                fallbackChats: [
                    { viewer_id: '파란커튼', sentiment: 'positive', text: '나도 그 장면 슬펐어' },
                    { viewer_id: '필름기포', sentiment: 'positive', text: '그 선택 때문에 여운이 더 크다' },
                    { viewer_id: '결말수집가', sentiment: 'neutral', text: '이어지지 않아서 더 기억남' }
                ],
                coreChat: {
                    id: 'movie-core-respect',
                    viewer_id: '필름기포',
                    sentiment: 'positive',
                    category: 'taste-respect',
                    text: '사랑보다 세상을 선택했다는 해석이 좋다.'
                }
            },
            {
                id: 'movie-ending',
                heroText: '정말 재미있었어요. 다음 편도 기대되네요! 오늘 같이 봐줘서 고맙고, 다음 영화 방송에서 만나요.',
                mood: 'warm',
                expression: 'smile',
                durationSeconds: 23,
                effects: { viewers: 3, opinion: 3 },
                fallbackChats: [
                    { viewer_id: '파란커튼', sentiment: 'positive', text: '다음 영화도 같이 보자' },
                    { viewer_id: '초록별', sentiment: 'positive', text: '오늘 분위기 최고' }
                ],
                donation: {
                    id: 'movie-donation-date',
                    viewer_id: '옆자리예약',
                    tone: 'negative',
                    amount: 11000,
                    text: '이렇게 둘이 영화 얘기하니까 데이트 같네요. 다음에도 다른 사람 말고 제 추천만 골라줘요.',
                    appropriateInstructions: ['deny', 'anger'],
                    heroResponses: {
                        accept: '좋아요. 다음 영화는 다른 추천보다 당신의 추천을 먼저 고를게요.',
                        deny: '함께 보는 기분은 좋지만 누군가만 특별 대우하진 않을게요. 추천은 모두에게 받을게요.',
                        joy: '같이 영화를 본 기분이었다니 기뻐요. 다음에도 모두 함께 감상해요!',
                        anger: '데이트라고 정하거나 다른 사람 추천을 막는 건 곤란해요. 선을 지켜주세요.',
                        sadness: '특별 대우를 약속하면 다른 분들과 함께한 시간이 흐려질 것 같아 속상해요.',
                        fun: '데이트 좌석은 없고 단체 관람석만 있습니다! 추천은 추첨함에 넣어주세요.'
                    },
                    timeoutResponse: '추천은 고맙지만 모두의 목록에서 공평하게 고를게요.'
                }
            }
        ]
    },
    {
        id: 'issue',
        title: '이슈 방송',
        shortTitle: '이슈',
        concept: '인터넷 만화 검열 강화 이슈를 두고 시청자와 토론하는 방송',
        background: 'cloud-news-studio',
        initialMetrics: {
            stress: 40,
            affection: 54,
            viewers: 118,
            positiveViewers: 76,
            opinion: 2,
            engagement: 50
        },
        beats: [
            {
                id: 'issue-opening',
                heroText: '아쿠아쨩의 뉴스 시간! 오늘은 인터넷 만화 검열 기준이 강화된다는 소식을 이야기해볼게요.',
                mood: 'focused',
                expression: 'default',
                durationSeconds: 25,
                effects: { viewers: 10, engagement: 7 },
                fallbackChats: [
                    { viewer_id: '팩트기포', sentiment: 'neutral', text: '무슨 기준이 바뀜?' },
                    { viewer_id: '양쪽구름', sentiment: 'neutral', text: '자료 링크 있나' },
                    { viewer_id: '불꽃제목', sentiment: 'negative', text: '오늘 주제 세다' }
                ]
            },
            {
                id: 'issue-distortion',
                heroText: '좋아하던 만화까지 못 보게 될까 걱정돼요. 하나씩 막다 보면 무해한 작품까지 검열하게 될 수 있잖아요.',
                mood: 'concerned',
                expression: 'shocked',
                durationSeconds: 24,
                effects: { engagement: 6 },
                fallbackChats: [
                    { viewer_id: '팩트기포', sentiment: 'neutral', text: '기준부터 공개해야지' },
                    { viewer_id: '불꽃제목', sentiment: 'neutral', text: '어디까지 문제로 볼지가 쟁점' },
                    { viewer_id: '양쪽구름', sentiment: 'neutral', text: '확대 적용이 걱정되긴 함' }
                ],
                coreChat: {
                    id: 'issue-core-dismissal',
                    viewer_id: '불꽃제목',
                    sentiment: 'negative',
                    category: 'content-dismissal',
                    text: '그런 만화는 내용 자체가 문제잖아.'
                }
            },
            {
                id: 'issue-side-donation',
                heroText: '기존 기준도 너무 엄격해요. 제 그림도 맨살 하나 없는데 반려됐다니까요? 옷 디자인까지 포함해서 그건 예술이에요!',
                mood: 'tense',
                expression: 'angry',
                durationSeconds: 25,
                effects: { opinion: -1, engagement: 5 },
                fallbackChats: [
                    { viewer_id: '팩트기포', sentiment: 'neutral', text: '맨살 없는데 왜 반려?' },
                    { viewer_id: '양쪽구름', sentiment: 'neutral', text: '옷 디자인 때문 아닌가' },
                    { viewer_id: '불꽃제목', sentiment: 'negative', text: '기준 공개해라' }
                ],
                donation: {
                    id: 'issue-donation-side',
                    viewer_id: '편을골라',
                    tone: 'negative',
                    amount: 15000,
                    text: '애매하게 말하지 말고 어느 쪽이 악인지 딱 정해주세요. 그래야 사람들이 방송을 보죠.',
                    appropriateInstructions: ['deny', 'anger'],
                    heroResponses: {
                        accept: '알겠어요. 지금부터 어느 쪽이 악인지 분명하게 정해서 이야기할게요.',
                        deny: '자극적인 편 가르기보다 확인된 사실과 개선할 점을 나누겠습니다.',
                        joy: '깊게 토론하려고 후원까지 해준 관심은 고마워요. 사실을 하나씩 살펴봐요.',
                        anger: '조회수를 위해 사람들을 악으로 낙인찍으라는 요구는 받아들이지 않겠습니다.',
                        sadness: '복잡한 문제를 악과 선으로만 나눠야 관심받는 현실은 조금 씁쓸하네요.',
                        fun: '악역 캐스팅은 오늘 휴무입니다. 대신 팩트와 맥락을 주연으로 세울게요!'
                    },
                    timeoutResponse: '근거 없이 어느 쪽을 악으로 정하진 않겠습니다.'
                }
            },
            {
                id: 'issue-factcheck',
                heroText: '보기 싫으면 안 보면 되고, 실제 인물도 아니잖아요. 모방범죄의 책임까지 작품 하나에 돌리는 건 맞지 않다고 생각해요.',
                mood: 'firm',
                expression: 'angry',
                durationSeconds: 24,
                effects: { opinion: 5, viewers: 5 },
                fallbackChats: [
                    { viewer_id: '팩트기포', sentiment: 'neutral', text: '선택권 문제지' },
                    { viewer_id: '양쪽구름', sentiment: 'neutral', text: '표현 자유도 한계는 있지' },
                    { viewer_id: '불꽃제목', sentiment: 'neutral', text: '작품과 범죄 책임은 나눠봐야지' }
                ],
                coreChat: {
                    id: 'issue-core-context',
                    viewer_id: '불꽃제목',
                    sentiment: 'neutral',
                    category: 'counterargument',
                    text: '모방범죄 가능성은 어떻게 봐요?'
                }
            },
            {
                id: 'issue-ending',
                heroText: '오늘 토론 유익했어요. 다른 의견도 같이 생각해볼 수 있어서 좋았습니다. 다음 방송에서 다시 만나요!',
                mood: 'resolved',
                expression: 'smile',
                durationSeconds: 24,
                effects: { opinion: 4, engagement: 2 },
                fallbackChats: [
                    { viewer_id: '양쪽구름', sentiment: 'positive', text: '결론 깔끔하다' },
                    { viewer_id: '팩트기포', sentiment: 'positive', text: '다음에도 이런 정리 부탁' }
                ],
                donation: {
                    id: 'issue-donation-ragebait',
                    viewer_id: '조회수폭풍',
                    tone: 'negative',
                    amount: 13000,
                    text: '제목을 “인터넷 만화 검열의 추악한 진실”로 바꾸면 조회수 두 배 갑니다. 지금 바꿔요!',
                    appropriateInstructions: ['deny', 'anger'],
                    heroResponses: {
                        accept: '좋아요. 조회수를 위해 지금 바로 더 자극적인 제목으로 바꿀게요.',
                        deny: '사실보다 센 제목으로 오해를 만들진 않을게요. 지금 제목이 오늘 내용에 맞아요.',
                        joy: '제목까지 고민해주는 열정은 고마워요. 정확하면서도 눈에 띄는 표현을 찾아볼게요.',
                        anger: '사실과 다른 제목으로 사람을 속이라는 말은 하지 마세요. 조회수보다 신뢰가 먼저예요.',
                        sadness: '정확한 내용보다 자극적인 제목만 남는다면 열심히 준비한 이야기가 아까워요.',
                        fun: '조회수 폭풍 대신 팩트 산들바람으로 갑시다! 제목은 그대로 유지할게요.'
                    },
                    timeoutResponse: '제목은 사실을 과장하지 않는 선에서 유지할게요.'
                }
            }
        ]
    }
];

export const AERO_LIVE_TOPICS = freezeDeep(AERO_LIVE_TOPIC_DEFINITIONS.map((topic, topicIndex) => ({
    ...topic,
    beats: topic.beats.map((beat, beatIndex) => ({
        ...beat,
        fallbackChats: beat.fallbackChats.map((chat, chatIndex) => ({
            ...chat,
            viewer_id: AERO_LIVE_VIEWER_IDS[(topicIndex * 15) + (beatIndex * 3) + chatIndex]
        }))
    }))
})));

/**
 * 주제에 배정된 15개의 제품 시청자 ID 복사본을 반환합니다.
 * @param {string} topicId - 방송 주제 ID입니다.
 * @param {ReadonlyArray<object>} [topics=AERO_LIVE_TOPICS] - ID 배정 순서를 정할 주제 목록입니다.
 * @returns {string[]} 알 수 없는 주제면 빈 배열, 그 외에는 해당 주제의 ID 15개입니다.
 */
export function getAeroLiveTopicViewerIds(topicId, topics = AERO_LIVE_TOPICS) {
    const topicIndex = Array.isArray(topics)
        ? topics.findIndex((topic) => topic?.id === topicId)
        : -1;
    if (topicIndex < 0) {
        return [];
    }
    const startIndex = topicIndex * 15;
    return AERO_LIVE_VIEWER_IDS.slice(startIndex, startIndex + 15);
}

/**
 * 씬의 주제 선택 화면에 필요한 가벼운 요약 목록을 반환합니다.
 * @param {ReadonlyArray<object>} [topics=AERO_LIVE_TOPICS] - 요약할 주제 목록입니다.
 * @param {{beatDurationSeconds?:number,coreChatSeconds?:number,donationSeconds?:number}} [timing=AERO_LIVE_DEFAULT_TIMING] - 요약에 반영할 런타임 시간 설정입니다.
 * @returns {object[]} 호출자가 안전하게 수정할 수 있는 주제 요약 목록입니다.
 */
export function getAeroLiveTopicSummaries(topics = AERO_LIVE_TOPICS, timing = AERO_LIVE_DEFAULT_TIMING) {
    const beatDurationOverride = Number(timing?.beatDurationSeconds);
    const hasBeatDurationOverride = Number.isFinite(beatDurationOverride) && beatDurationOverride > 0;
    const coreChatSeconds = Number(timing?.coreChatSeconds);
    const donationSeconds = Number(timing?.donationSeconds);
    const resolvedCoreChatSeconds = Number.isFinite(coreChatSeconds) && coreChatSeconds > 0
        ? coreChatSeconds
        : AERO_LIVE_DEFAULT_TIMING.coreChatSeconds;
    const resolvedDonationSeconds = Number.isFinite(donationSeconds) && donationSeconds > 0
        ? donationSeconds
        : AERO_LIVE_DEFAULT_TIMING.donationSeconds;

    return topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        shortTitle: topic.shortTitle,
        concept: topic.concept,
        background: topic.background,
        moods: [...new Set(topic.beats.map((beat) => beat.mood))],
        beatCount: topic.beats.length,
        estimatedSeconds: topic.beats.reduce((total, beat) => {
            const promptSeconds = beat.coreChat
                ? resolvedCoreChatSeconds
                : beat.donation
                    ? resolvedDonationSeconds
                    : 0;
            const beatSeconds = hasBeatDurationOverride ? beatDurationOverride : beat.durationSeconds;
            return total + beatSeconds + promptSeconds;
        }, 0)
    }));
}

/**
 * 식별자에 맞는 방송 주제 원본을 반환합니다.
 * @param {string} topicId - 조회할 주제 식별자입니다.
 * @param {ReadonlyArray<object>} [topics=AERO_LIVE_TOPICS] - 조회할 주제 목록입니다.
 * @returns {object|null} 동결된 주제 객체 또는 null입니다.
 */
export function getAeroLiveTopicById(topicId, topics = AERO_LIVE_TOPICS) {
    return topics.find((topic) => topic.id === topicId) || null;
}
