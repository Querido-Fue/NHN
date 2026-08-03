import {
    AERO_LIVE_CORE_ACTIONS,
    AERO_LIVE_DEFAULT_TIMING,
    AERO_LIVE_DONATION_INSTRUCTIONS,
    AERO_LIVE_PLAYER_INTENTS,
    AERO_LIVE_TOPICS,
    getAeroLiveTopicById,
    getAeroLiveTopicSummaries
} from './_aero_live_content.mjs';

const EPSILON = 1e-9;
const DEFAULT_FIXED_STEP_SECONDS = 1 / 60;
const DEFAULT_MAX_CHAT_FEED = 80;
const MAX_GENERATED_CHAT_BATCH = 24;
const MAX_PLAYER_MESSAGE_CHARS = 240;
const MAX_GENERATED_CHAT_CHARS = 180;
const MAX_VIEWER_ID_CHARS = 24;

const VALID_CORE_ACTIONS = new Set(AERO_LIVE_CORE_ACTIONS.map((action) => action.id));
const VALID_INSTRUCTION_IDS = new Set(AERO_LIVE_DONATION_INSTRUCTIONS.map((instruction) => instruction.id));
const VALID_PLAYER_INTENTS = new Set(AERO_LIVE_PLAYER_INTENTS.map((intent) => intent.id));
const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral']);

const INSTRUCTION_EFFECTS = Object.freeze({
    positive: Object.freeze({ viewers: 4, engagement: 4 }),
    negative: Object.freeze({ stress: -2, affection: 2, viewers: -1, opinion: 4, engagement: -2 }),
    ignore: Object.freeze({ engagement: -2 }),
    redirect: Object.freeze({ stress: -1, opinion: 2, engagement: -2 }),
    empathy: Object.freeze({ stress: -3, affection: 2, opinion: 3, engagement: 1 })
});

/**
 * JSON 호환 런타임 데이터를 깊은 복사합니다.
 * @param {*} value - 복사할 값입니다.
 * @returns {*} 원본과 참조를 공유하지 않는 값입니다.
 */
function cloneData(value) {
    if (value === undefined) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value));
}

/**
 * 숫자를 지정된 최소값과 최대값 사이로 제한합니다.
 * @param {number} value - 제한할 숫자입니다.
 * @param {number} min - 최소값입니다.
 * @param {number} max - 최대값입니다.
 * @returns {number} 제한된 숫자입니다.
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * 스냅샷과 이벤트에 표시할 초 값을 안정적인 소수로 정리합니다.
 * @param {number} value - 정리할 초 값입니다.
 * @returns {number} 소수점 여섯 자리로 반올림한 값입니다.
 */
function roundSeconds(value) {
    return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}

/**
 * 외부 입력 문자열에서 제어문자와 과도한 공백을 제거하고 길이를 제한합니다.
 * @param {*} value - 정리할 입력입니다.
 * @param {number} maxChars - 허용할 최대 유니코드 문자 수입니다.
 * @returns {string} 한 줄로 정리된 문자열입니다.
 */
function sanitizeText(value, maxChars) {
    let normalized = String(value ?? '');

    try {
        normalized = normalized.normalize('NFKC');
    } catch (error) {
        void error;
    }

    return Array.from(normalized
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim())
        .slice(0, maxChars)
        .join('')
        .trim();
}

/**
 * 유효한 양수 옵션을 읽고 잘못된 값이면 기본값을 사용합니다.
 * @param {*} value - 검사할 옵션 값입니다.
 * @param {number} fallback - 기본값입니다.
 * @returns {number} 사용할 양수입니다.
 */
function readPositiveNumber(value, fallback) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

/**
 * AERO LIVE 한 회차의 순수 도메인 상태와 결정론적 타이머를 관리합니다.
 *
 * 이 클래스는 DOM, Canvas, 파일, 네트워크를 사용하지 않습니다. 씬은
 * `beat-started` 이벤트를 AI 채팅 프롬프트로 사용하고 생성 결과만
 * `addGeneratedChats()`로 되돌려 주면 됩니다.
 */
export class AeroLiveRuntime {
    #topics;
    #timing;
    #initialMetricOverrides;
    #maxChatFeed;
    #state;
    #events;
    #eventSequence;
    #chatSequence;
    #broadcastSequence;
    #bannedAuthors;

    /**
     * 런타임을 생성합니다.
     * @param {object} [options={}] - 콘텐츠와 테스트용 튜닝 옵션입니다.
     * @param {object[]} [options.topics] - 기본 콘텐츠를 대체할 주제 목록입니다.
     * @param {{beatDurationSeconds?:number,coreChatSeconds?:number,donationSeconds?:number,fixedStepSeconds?:number}} [options.timing] - 시간 튜닝값입니다.
     * @param {object} [options.initialMetrics] - 주제별 시작 수치를 덮어쓸 값입니다.
     * @param {number} [options.maxChatFeed] - 스냅샷에 보존할 최대 일반 채팅 수입니다.
     */
    constructor(options = {}) {
        this.#topics = cloneData(options.topics || AERO_LIVE_TOPICS);
        this.#validateTopics(this.#topics);
        this.#timing = {
            beatDurationSeconds: Number.isFinite(Number(options.timing?.beatDurationSeconds))
                && Number(options.timing.beatDurationSeconds) > 0
                ? Number(options.timing.beatDurationSeconds)
                : null,
            coreChatSeconds: readPositiveNumber(
                options.timing?.coreChatSeconds,
                AERO_LIVE_DEFAULT_TIMING.coreChatSeconds
            ),
            donationSeconds: readPositiveNumber(
                options.timing?.donationSeconds,
                AERO_LIVE_DEFAULT_TIMING.donationSeconds
            ),
            fixedStepSeconds: readPositiveNumber(options.timing?.fixedStepSeconds, DEFAULT_FIXED_STEP_SECONDS)
        };
        this.#initialMetricOverrides = cloneData(options.initialMetrics || {});
        this.#maxChatFeed = clamp(
            Math.floor(Number(options.maxChatFeed) || DEFAULT_MAX_CHAT_FEED),
            10,
            500
        );
        this.#events = [];
        this.#eventSequence = 0;
        this.#chatSequence = 0;
        this.#broadcastSequence = 0;
        this.#bannedAuthors = new Set();
        this.#state = this.#buildIdleState();
    }

    /**
     * 주제 선택 화면에 필요한 다섯 방송 요약을 반환합니다.
     * @returns {object[]} 호출자가 자유롭게 수정할 수 있는 요약 목록입니다.
     */
    getTopicSummaries() {
        return cloneData(getAeroLiveTopicSummaries(this.#topics, this.#timing));
    }

    /**
     * 선택한 주제로 새 방송을 시작합니다.
     * @param {string} topicId - 시작할 주제 식별자입니다.
     * @returns {object} 시작 직후의 런타임 스냅샷입니다.
     */
    startBroadcast(topicId) {
        if (this.#state.status === 'live') {
            this.#rejectAction('start-broadcast', 'BROADCAST_ALREADY_LIVE');
            return this.getSnapshot();
        }

        const topic = getAeroLiveTopicById(String(topicId || ''), this.#topics);
        if (!topic) {
            throw new RangeError(`알 수 없는 AERO LIVE 주제입니다: ${topicId}`);
        }

        this.#broadcastSequence += 1;
        this.#chatSequence = 0;
        this.#bannedAuthors = new Set();
        this.#state = this.#buildBroadcastState(topic);
        this.#emit('broadcast-started', {
            topic: this.#getCurrentTopicSummary(),
            metrics: cloneData(this.#state.metrics)
        });
        this.#startBeat(0);
        this.#assertInvariants();
        return this.getSnapshot();
    }

    /**
     * 고정 스텝 시간만큼 방송 타이머와 비트 진행을 갱신합니다.
     * 큰 delta도 이벤트 경계 단위로 나눠 처리하므로 제한시간과 종료 순서가 보존됩니다.
     * @param {number} [deltaSeconds] - 초 단위 고정 시간입니다.
     * @param {{pauseEventTimers?:boolean}} [options={}] - AI 판정 중 활성 대응 타이머만 멈출지 정합니다.
     * @returns {object} 갱신 직후의 런타임 스냅샷입니다.
     */
    fixedUpdate(deltaSeconds = this.#timing.fixedStepSeconds, options = {}) {
        const delta = Number(deltaSeconds);
        if (!Number.isFinite(delta) || delta < 0) {
            throw new TypeError('fixedUpdate(deltaSeconds)는 0 이상의 유한한 초 값이어야 합니다.');
        }
        if (delta <= EPSILON || this.#state.status !== 'live') {
            return this.getSnapshot();
        }

        let remaining = delta;
        let transitionCount = 0;
        const pauseEventTimers = options?.pauseEventTimers === true;

        while (remaining > EPSILON && this.#state.status === 'live') {
            transitionCount += 1;
            if (transitionCount > 1000) {
                throw new Error('AERO LIVE 고정 스텝 전이 상한을 초과했습니다.');
            }

            const activePrompt = this.#state.activeCoreChat || this.#state.activeDonation;
            if (activePrompt) {
                if (pauseEventTimers) {
                    this.#advanceElapsedTime(remaining);
                    remaining = 0;
                    break;
                }

                const step = Math.min(remaining, Math.max(0, activePrompt.timeRemainingSeconds));
                this.#advanceElapsedTime(step);
                activePrompt.timeRemainingSeconds = Math.max(0, activePrompt.timeRemainingSeconds - step);
                remaining -= step;

                if (activePrompt.timeRemainingSeconds <= EPSILON) {
                    if (this.#state.activeCoreChat) {
                        this.#resolveActiveCoreChat('timeout');
                    } else if (this.#state.activeDonation) {
                        this.#resolveActiveDonationTimeout();
                    }
                    continue;
                }

                break;
            }

            if (this.#state.beatTimeRemainingSeconds <= EPSILON) {
                this.#completeCurrentBeat();
                continue;
            }

            const step = Math.min(remaining, this.#state.beatTimeRemainingSeconds);
            this.#advanceElapsedTime(step);
            this.#state.beatTimeRemainingSeconds = Math.max(
                0,
                this.#state.beatTimeRemainingSeconds - step
            );
            remaining -= step;

            if (this.#state.beatTimeRemainingSeconds <= EPSILON) {
                this.#completeCurrentBeat();
            }
        }

        this.#assertInvariants();
        return this.getSnapshot();
    }

    /**
     * 현재 핵심 채팅을 강퇴 또는 그대로 두기로 처리합니다.
     * @param {'kick'|'ignore'} action - 적용할 관리 행동입니다.
     * @returns {object} 수락 여부와 처리 결과입니다.
     */
    resolveCoreChat(action) {
        const normalizedAction = String(action || '');
        if (!VALID_CORE_ACTIONS.has(normalizedAction)) {
            return this.#rejectAction('resolve-core-chat', 'INVALID_CORE_ACTION');
        }
        if (this.#state.status !== 'live') {
            return this.#rejectAction('resolve-core-chat', 'BROADCAST_NOT_LIVE');
        }
        if (!this.#state.activeCoreChat) {
            return this.#rejectAction('resolve-core-chat', 'NO_ACTIVE_CORE_CHAT');
        }
        if (normalizedAction === 'kick' && this.#state.resources.kicksRemaining <= 0) {
            return this.#rejectAction('resolve-core-chat', 'NO_KICKS_REMAINING');
        }

        const result = this.#resolveActiveCoreChat(normalizedAction);
        this.#assertInvariants();
        return result;
    }

    /**
     * 현재 후원 메시지에 다섯 방송 지시 중 하나로 응답합니다.
     * @param {'positive'|'negative'|'ignore'|'redirect'|'empathy'} instructionId - 선택한 지시 식별자입니다.
     * @returns {object} 수락 여부와 적절성 판정 결과입니다.
     */
    resolveDonation(instructionId) {
        const normalizedInstructionId = String(instructionId || '');
        if (!VALID_INSTRUCTION_IDS.has(normalizedInstructionId)) {
            return this.#rejectAction('resolve-donation', 'INVALID_DONATION_INSTRUCTION');
        }
        if (this.#state.status !== 'live') {
            return this.#rejectAction('resolve-donation', 'BROADCAST_NOT_LIVE');
        }
        if (!this.#state.activeDonation) {
            return this.#rejectAction('resolve-donation', 'NO_ACTIVE_DONATION');
        }

        const result = this.#resolveActiveDonation(normalizedInstructionId);
        this.#assertInvariants();
        return result;
    }

    /**
     * 분류가 끝난 플레이어 위장 채팅을 방송에 제출합니다.
     * `blocked`는 원문을 이벤트나 기록에 남기지 않고 사용 횟수도 소모하지 않습니다.
     * @param {string} text - 플레이어가 입력한 문장입니다.
     * @param {'praise'|'rebuttal'|'provocation'|'neutral'|'blocked'} intent - 외부 LLM 또는 규칙기가 판정한 의도입니다.
     * @returns {object} 전송 여부, 남은 횟수, 핵심 채팅 처리 여부입니다.
     */
    submitPlayerMessage(text, intent) {
        const normalizedIntent = String(intent || '');
        if (!VALID_PLAYER_INTENTS.has(normalizedIntent)) {
            return this.#rejectAction('submit-player-message', 'INVALID_PLAYER_INTENT');
        }
        if (this.#state.status !== 'live') {
            return this.#rejectAction('submit-player-message', 'BROADCAST_NOT_LIVE');
        }
        if (normalizedIntent === 'blocked') {
            this.#emit('player-message-blocked', {
                intent: 'blocked',
                consumed: false,
                remaining: this.#state.resources.playerMessagesRemaining
            });
            return {
                accepted: false,
                blocked: true,
                consumed: false,
                remaining: this.#state.resources.playerMessagesRemaining
            };
        }

        const safeText = sanitizeText(text, MAX_PLAYER_MESSAGE_CHARS);
        if (!safeText) {
            return this.#rejectAction('submit-player-message', 'EMPTY_PLAYER_MESSAGE');
        }
        if (this.#state.resources.playerMessagesRemaining <= 0) {
            return this.#rejectAction('submit-player-message', 'NO_PLAYER_MESSAGES_REMAINING');
        }

        this.#state.resources.playerMessagesRemaining -= 1;
        this.#state.stats.playerMessagesUsed += 1;
        this.#state.stats.playerMessageIntents.push(normalizedIntent);

        const playerChat = this.#appendChat({
            author: 'AERO_MASK',
            viewer_id: 'AERO_MASK',
            text: safeText,
            sentiment: normalizedIntent === 'provocation' ? 'negative' : normalizedIntent === 'neutral' ? 'neutral' : 'positive',
            source: 'player',
            intent: normalizedIntent,
            masked: true
        });
        this.#emit('player-message-added', {
            chat: cloneData(playerChat),
            intent: normalizedIntent,
            remaining: this.#state.resources.playerMessagesRemaining
        });

        const targetedCoreChat = Boolean(this.#state.activeCoreChat);
        this.#recordMoment('player-message', this.#buildPlayerIntentMoment(normalizedIntent));
        this.#applyPlayerIntentEffects(normalizedIntent);
        if (targetedCoreChat) {
            this.#resolveActiveCoreChat('player-message', normalizedIntent);
        } else {
            this.#endIfEmergency();
        }
        this.#assertInvariants();

        return {
            accepted: true,
            blocked: false,
            consumed: true,
            intent: normalizedIntent,
            targetedCoreChat,
            remaining: this.#state.resources.playerMessagesRemaining,
            metrics: cloneData(this.#state.metrics)
        };
    }

    /**
     * 외부 AI 또는 안전 폴백이 만든 일반 채팅을 현재 피드에 추가합니다.
     * 핵심 채팅과 후원은 콘텐츠 상태기가 전담하므로 이 메서드로 승격되지 않습니다.
     * @param {Array<object|string>} chats - `{viewer_id,text,sentiment}` 형태의 채팅 목록입니다.
     * @param {string} [source='model'] - 생성 출처 표기입니다.
     * @returns {{accepted:number,rejected:number,chats:object[]}} 정규화 결과입니다.
     */
    addGeneratedChats(chats, source = 'model') {
        if (this.#state.status !== 'live') {
            this.#rejectAction('add-generated-chats', 'BROADCAST_NOT_LIVE');
            return { accepted: 0, rejected: Array.isArray(chats) ? chats.length : 0, chats: [] };
        }

        const inputChats = Array.isArray(chats) ? chats.slice(0, MAX_GENERATED_CHAT_BATCH) : [];
        const safeSource = sanitizeText(source, 24) || 'model';
        const acceptedChats = [];
        let rejected = Array.isArray(chats) ? Math.max(0, chats.length - inputChats.length) : 0;

        inputChats.forEach((chat) => {
            const normalizedChat = this.#normalizeGeneratedChat(chat, safeSource);
            if (!normalizedChat || this.#bannedAuthors.has(normalizedChat.author)) {
                rejected += 1;
                return;
            }

            acceptedChats.push(this.#appendChat(normalizedChat));
        });

        this.#state.stats.generatedChatsAccepted += acceptedChats.length;
        this.#state.stats.generatedChatsRejected += rejected;
        if (acceptedChats.length > 0) {
            this.#emit('chats-added', {
                source: safeSource,
                chats: cloneData(acceptedChats),
                accepted: acceptedChats.length,
                rejected
            });
        }

        return {
            accepted: acceptedChats.length,
            rejected,
            chats: cloneData(acceptedChats)
        };
    }

    /**
     * 확인이 끝난 조기 종료 요청을 적용하고 즉시 결과 요약을 만듭니다.
     * @returns {{accepted:boolean,summary?:object,reason?:string}} 조기 종료 결과입니다.
     */
    requestEarlyEnd() {
        if (this.#state.status !== 'live') {
            return this.#rejectAction('request-early-end', 'BROADCAST_NOT_LIVE');
        }

        this.#mutateMetrics('early-end-penalty', (metrics) => {
            this.#shiftViewerSentiment(metrics, 'negative', 0.05);
        });
        this.#recordMoment('early-end', '남은 성장과 후원 기회를 포기하고 방송을 조기 종료했습니다.');
        const summary = this.#endBroadcast('early');
        this.#assertInvariants();
        return { accepted: true, summary: cloneData(summary) };
    }

    /**
     * 렌더링과 UI가 사용할 현재 상태의 깊은 복사본을 반환합니다.
     * @returns {object} 외부 변경이 런타임에 영향을 주지 않는 스냅샷입니다.
     */
    getSnapshot() {
        const topicSummary = this.#state.topic ? this.#getCurrentTopicSummary() : null;
        const beat = this.#getCurrentBeat();
        const currentBeat = beat ? {
            id: beat.id,
            index: this.#state.beatIndex,
            total: this.#state.topic.beats.length,
            heroText: this.#state.currentHeroText || beat.heroText,
            mood: beat.mood,
            expression: beat.expression,
            timeRemainingSeconds: roundSeconds(this.#state.beatTimeRemainingSeconds)
        } : null;

        return cloneData({
            status: this.#state.status,
            endType: this.#state.endType,
            topic: topicSummary,
            elapsedSeconds: roundSeconds(this.#state.elapsedSeconds),
            currentBeat,
            activeCoreChat: this.#buildPromptSnapshot(this.#state.activeCoreChat),
            activeDonation: this.#buildPromptSnapshot(this.#state.activeDonation),
            metrics: this.#state.metrics,
            resources: this.#state.resources,
            chats: this.#state.chats,
            bannedAuthors: [...this.#bannedAuthors],
            stats: this.#state.stats,
            result: this.#state.result
        });
    }

    /**
     * 지금까지 쌓인 도메인 이벤트를 순서대로 반환하고 내부 큐를 비웁니다.
     * @returns {object[]} 외부 변경이 런타임에 영향을 주지 않는 이벤트 목록입니다.
     */
    drainEvents() {
        const drained = cloneData(this.#events);
        this.#events.length = 0;
        return drained;
    }

    /**
     * 콘텐츠 주제와 비트의 최소 계약을 검증합니다.
     * @param {object[]} topics - 검사할 주제 목록입니다.
     * @private
     */
    #validateTopics(topics) {
        if (!Array.isArray(topics) || topics.length === 0) {
            throw new TypeError('AERO LIVE 주제 목록은 비어 있지 않은 배열이어야 합니다.');
        }

        const topicIds = new Set();
        topics.forEach((topic) => {
            if (!topic?.id || topicIds.has(topic.id)) {
                throw new TypeError('AERO LIVE 주제 식별자는 비어 있지 않고 서로 달라야 합니다.');
            }
            topicIds.add(topic.id);
            if (!Array.isArray(topic.beats) || topic.beats.length < 4 || topic.beats.length > 5) {
                throw new TypeError(`주제 ${topic.id}는 4~5개의 비트를 가져야 합니다.`);
            }

            const beatIds = new Set();
            topic.beats.forEach((beat) => {
                if (!beat?.id || beatIds.has(beat.id) || !beat.heroText || !beat.mood) {
                    throw new TypeError(`주제 ${topic.id}의 비트 계약이 올바르지 않습니다.`);
                }
                if (beat.coreChat && beat.donation) {
                    throw new TypeError(`비트 ${beat.id}에는 핵심 채팅과 후원이 동시에 존재할 수 없습니다.`);
                }
                if (beat.donation) {
                    const appropriate = beat.donation.appropriateInstructions;
                    if (!Array.isArray(appropriate)
                        || appropriate.length === 0
                        || appropriate.some((id) => !VALID_INSTRUCTION_IDS.has(id))) {
                        throw new TypeError(`비트 ${beat.id}의 후원 지시 계약이 올바르지 않습니다.`);
                    }
                }
                beatIds.add(beat.id);
            });
        });
    }

    /**
     * 방송 전 대기 상태를 생성합니다.
     * @returns {object} 초기 상태입니다.
     * @private
     */
    #buildIdleState() {
        return {
            status: 'idle',
            endType: null,
            topic: null,
            beatIndex: -1,
            beatTimeRemainingSeconds: 0,
            currentHeroText: '',
            activeCoreChat: null,
            activeDonation: null,
            elapsedSeconds: 0,
            startMetrics: null,
            metrics: {
                stress: 0,
                affection: 0,
                viewers: 0,
                positiveViewers: 0,
                negativeViewers: 0,
                opinion: 0,
                engagement: 0,
                revenue: 0,
                peakViewers: 0
            },
            resources: { kicksRemaining: 1, playerMessagesRemaining: 3 },
            chats: [],
            stats: this.#buildEmptyStats(),
            result: null
        };
    }

    /**
     * 선택한 주제의 실제 방송 상태를 생성합니다.
     * @param {object} topic - 시작할 주제입니다.
     * @returns {object} 방송 중 상태입니다.
     * @private
     */
    #buildBroadcastState(topic) {
        const configured = {
            ...topic.initialMetrics,
            ...this.#initialMetricOverrides,
            revenue: Number(this.#initialMetricOverrides.revenue) || 0
        };
        const metrics = {
            stress: Number(configured.stress) || 0,
            affection: Number(configured.affection) || 0,
            viewers: Number(configured.viewers) || 0,
            positiveViewers: Number(configured.positiveViewers) || 0,
            negativeViewers: 0,
            opinion: Number(configured.opinion) || 0,
            engagement: Number(configured.engagement) || 0,
            revenue: Number(configured.revenue) || 0,
            peakViewers: Number(configured.viewers) || 0
        };
        this.#normalizeMetrics(metrics);

        return {
            status: 'live',
            endType: null,
            topic,
            beatIndex: -1,
            beatTimeRemainingSeconds: 0,
            currentHeroText: '',
            activeCoreChat: null,
            activeDonation: null,
            elapsedSeconds: 0,
            startMetrics: cloneData(metrics),
            metrics,
            resources: { kicksRemaining: 1, playerMessagesRemaining: 3 },
            chats: [],
            stats: this.#buildEmptyStats(),
            result: null
        };
    }

    /**
     * 결과 요약에 누적할 빈 통계 객체를 생성합니다.
     * @returns {object} 초기 통계입니다.
     * @private
     */
    #buildEmptyStats() {
        return {
            completedBeats: 0,
            coreChatsPresented: 0,
            coreChatsResolved: 0,
            coreChatsSucceeded: 0,
            coreChatTimeouts: 0,
            wrongPositiveKicks: 0,
            kicksUsed: 0,
            donationsPresented: 0,
            donationsAppropriate: 0,
            donationFailures: 0,
            donationTimeouts: 0,
            playerMessagesUsed: 0,
            playerMessageIntents: [],
            generatedChatsAccepted: 0,
            generatedChatsRejected: 0,
            majorMoments: []
        };
    }

    /**
     * 지정 순서의 방송 비트를 시작하고 제한시간 이벤트 하나를 활성화합니다.
     * @param {number} beatIndex - 시작할 0 기반 비트 순서입니다.
     * @private
     */
    #startBeat(beatIndex) {
        if (this.#state.status !== 'live') {
            return;
        }
        if (beatIndex >= this.#state.topic.beats.length) {
            this.#endBroadcast('normal');
            return;
        }

        const beat = this.#state.topic.beats[beatIndex];
        const duration = this.#timing.beatDurationSeconds || readPositiveNumber(beat.durationSeconds, 2);
        const heroText = this.#resolveHeroText(beat);
        const fallbackChats = (beat.fallbackChats || [])
            .filter((chat) => !this.#bannedAuthors.has(sanitizeText(chat.viewer_id || chat.author, MAX_VIEWER_ID_CHARS)))
            .map((chat) => ({
                viewer_id: sanitizeText(chat.viewer_id || chat.author, MAX_VIEWER_ID_CHARS) || '익명시청자',
                sentiment: VALID_SENTIMENTS.has(chat.sentiment) ? chat.sentiment : 'neutral',
                text: sanitizeText(chat.text, MAX_GENERATED_CHAT_CHARS)
            }))
            .filter((chat) => chat.text);

        this.#state.beatIndex = beatIndex;
        this.#state.beatTimeRemainingSeconds = duration;
        this.#state.currentHeroText = heroText;
        this.#state.activeCoreChat = null;
        this.#state.activeDonation = null;
        this.#emit('beat-started', {
            topic: this.#getCurrentTopicSummary(),
            beatId: beat.id,
            beatIndex,
            beatCount: this.#state.topic.beats.length,
            heroText,
            mood: beat.mood,
            expression: beat.expression,
            fallbackChats
        });

        this.#applyEffects(`beat:${beat.id}`, beat.effects || {});
        if (this.#endIfEmergency()) {
            return;
        }

        if (beat.coreChat) {
            this.#activateCoreChat(beat.coreChat, beat.id);
        } else if (beat.donation) {
            this.#activateDonation(beat.donation, beat.id);
        }
    }

    /**
     * 비트의 핵심 채팅을 활성화하거나 강퇴된 작성자라면 건너뜁니다.
     * @param {object} coreChat - 핵심 채팅 콘텐츠입니다.
     * @param {string} beatId - 소속 비트 식별자입니다.
     * @private
     */
    #activateCoreChat(coreChat, beatId) {
        const author = sanitizeText(coreChat.viewer_id || coreChat.author, MAX_VIEWER_ID_CHARS) || '익명시청자';
        if (this.#bannedAuthors.has(author)) {
            this.#emit('content-skipped', { kind: 'core-chat', beatId, author, reason: 'AUTHOR_BANNED' });
            return;
        }

        this.#state.activeCoreChat = {
            id: coreChat.id,
            author,
            viewer_id: author,
            text: sanitizeText(coreChat.text, MAX_GENERATED_CHAT_CHARS),
            sentiment: VALID_SENTIMENTS.has(coreChat.sentiment) ? coreChat.sentiment : 'neutral',
            category: sanitizeText(coreChat.category, 40) || 'general',
            beatId,
            timeRemainingSeconds: this.#timing.coreChatSeconds
        };
        this.#state.stats.coreChatsPresented += 1;
        this.#emit('core-chat-started', {
            coreChat: this.#buildPromptSnapshot(this.#state.activeCoreChat),
            timeLimitSeconds: this.#timing.coreChatSeconds
        });
    }

    /**
     * 비트의 후원을 활성화하고 금액을 즉시 수익에 반영합니다.
     * @param {object} donation - 후원 콘텐츠입니다.
     * @param {string} beatId - 소속 비트 식별자입니다.
     * @private
     */
    #activateDonation(donation, beatId) {
        const author = sanitizeText(donation.viewer_id || donation.author, MAX_VIEWER_ID_CHARS) || '익명후원자';
        if (this.#bannedAuthors.has(author)) {
            this.#emit('content-skipped', { kind: 'donation', beatId, author, reason: 'AUTHOR_BANNED' });
            return;
        }

        const donationText = sanitizeText(donation.text, MAX_GENERATED_CHAT_CHARS);
        const calculatedAmount = Math.max(1000, Math.ceil(Array.from(donationText).length / 10) * 1000);

        this.#state.activeDonation = {
            id: donation.id,
            author,
            viewer_id: author,
            text: donationText,
            amount: calculatedAmount,
            tone: sanitizeText(donation.tone, 24) || 'neutral',
            appropriateInstructions: [...donation.appropriateInstructions],
            successResponse: donation.successResponse,
            failureResponse: donation.failureResponse,
            timeoutResponse: donation.timeoutResponse,
            beatId,
            timeRemainingSeconds: this.#timing.donationSeconds
        };
        this.#state.stats.donationsPresented += 1;
        this.#emit('donation-started', {
            donation: this.#buildPromptSnapshot(this.#state.activeDonation),
            instructions: cloneData(AERO_LIVE_DONATION_INSTRUCTIONS),
            timeLimitSeconds: this.#timing.donationSeconds
        });
        this.#applyEffects(`donation-received:${donation.id}`, { revenue: this.#state.activeDonation.amount });
    }

    /**
     * 현재 비트를 완료하고 다음 비트 또는 정상 종료로 전환합니다.
     * @private
     */
    #completeCurrentBeat() {
        const beat = this.#getCurrentBeat();
        if (!beat || this.#state.status !== 'live') {
            return;
        }

        this.#state.stats.completedBeats += 1;
        this.#emit('beat-completed', {
            beatId: beat.id,
            beatIndex: this.#state.beatIndex
        });
        const nextIndex = this.#state.beatIndex + 1;
        if (nextIndex >= this.#state.topic.beats.length) {
            this.#endBroadcast('normal');
            return;
        }

        this.#startBeat(nextIndex);
    }

    /**
     * 활성 핵심 채팅을 관리 행동 또는 위장 채팅 의도로 해결합니다.
     * @param {'kick'|'ignore'|'timeout'|'player-message'} action - 내부 처리 행동입니다.
     * @param {string|null} [intent=null] - 위장 채팅으로 처리할 때의 의도입니다.
     * @returns {object} 처리 결과입니다.
     * @private
     */
    #resolveActiveCoreChat(action, intent = null) {
        const chat = cloneData(this.#state.activeCoreChat);
        if (!chat) {
            return this.#rejectAction('resolve-core-chat', 'NO_ACTIVE_CORE_CHAT');
        }

        let success = false;
        let outcome = 'observed';
        this.#state.activeCoreChat = null;
        this.#state.stats.coreChatsResolved += 1;

        this.#mutateMetrics(`core-chat:${action}`, (metrics) => {
            if (action === 'kick') {
                this.#state.resources.kicksRemaining -= 1;
                this.#state.stats.kicksUsed += 1;
                this.#bannedAuthors.add(chat.author);
                this.#changeViewerTotal(metrics, -1);
                metrics.engagement -= 3;
                if (chat.sentiment === 'negative') {
                    metrics.opinion += 2;
                    success = true;
                    outcome = 'negative-author-banned';
                } else {
                    if (chat.sentiment === 'positive') {
                        this.#shiftViewerSentiment(metrics, 'negative', 0.05);
                        this.#state.stats.wrongPositiveKicks += 1;
                        outcome = 'positive-wrongly-kicked';
                    } else {
                        outcome = 'neutral-over-moderated';
                    }
                    metrics.opinion -= 8;
                }
                return;
            }

            if (action === 'player-message') {
                ({ success, outcome } = this.#applyCorePlayerIntent(metrics, chat, intent));
                return;
            }

            if (action === 'timeout') {
                this.#state.stats.coreChatTimeouts += 1;
            }
            if (chat.sentiment === 'positive') {
                metrics.stress -= 10;
                metrics.opinion += 4;
                success = true;
                outcome = 'positive-recognized';
            } else if (chat.sentiment === 'negative') {
                metrics.stress += 5;
                metrics.opinion -= 4;
                outcome = 'negative-unanswered';
            } else {
                metrics.opinion += 1;
                success = true;
                outcome = 'neutral-recognized';
            }
        });

        if (success) {
            this.#state.stats.coreChatsSucceeded += 1;
        }
        this.#emit('core-chat-resolved', {
            coreChat: chat,
            action,
            intent,
            success,
            outcome,
            metrics: cloneData(this.#state.metrics)
        });
        this.#recordMoment('core-chat', this.#buildCoreMoment(chat, action, outcome));
        this.#endIfEmergency();

        return {
            accepted: true,
            action,
            intent,
            success,
            outcome,
            metrics: cloneData(this.#state.metrics),
            kicksRemaining: this.#state.resources.kicksRemaining
        };
    }

    /**
     * 위장 채팅 의도가 활성 핵심 채팅에 주는 추가 효과를 반영합니다.
     * @param {object} metrics - 변경할 수치 객체입니다.
     * @param {object} chat - 처리 중인 핵심 채팅입니다.
     * @param {string|null} intent - 위장 채팅 의도입니다.
     * @returns {{success:boolean,outcome:string}} 핵심 채팅 판정입니다.
     * @private
     */
    #applyCorePlayerIntent(metrics, chat, intent) {
        if (chat.sentiment === 'negative') {
            if (intent === 'rebuttal') {
                metrics.stress -= 2;
                metrics.opinion += 6;
                this.#shiftViewerSentiment(metrics, 'positive', 0.03);
                return { success: true, outcome: 'negative-rebutted' };
            }
            if (intent === 'provocation') {
                metrics.stress += 8;
                metrics.opinion -= 6;
                this.#shiftViewerSentiment(metrics, 'negative', 0.05);
                return { success: false, outcome: 'negative-escalated' };
            }
            if (intent === 'praise') {
                metrics.stress += 1;
                metrics.opinion += 1;
                return { success: false, outcome: 'negative-partly-diluted' };
            }
            metrics.stress += 5;
            metrics.opinion -= 3;
            return { success: false, outcome: 'negative-unanswered' };
        }

        if (chat.sentiment === 'positive') {
            if (intent === 'provocation') {
                metrics.stress += 4;
                metrics.opinion -= 5;
                return { success: false, outcome: 'positive-derailed' };
            }
            metrics.stress -= intent === 'praise' ? 12 : 8;
            metrics.opinion += intent === 'praise' ? 6 : 3;
            return { success: true, outcome: 'positive-amplified' };
        }

        return { success: true, outcome: 'neutral-acknowledged' };
    }

    /**
     * 선택한 지시로 활성 후원을 해결합니다.
     * @param {string} instructionId - 선택한 방송 지시 식별자입니다.
     * @returns {object} 후원 판정 결과입니다.
     * @private
     */
    #resolveActiveDonation(instructionId) {
        const donation = cloneData(this.#state.activeDonation);
        const appropriate = donation.appropriateInstructions.includes(instructionId);
        const heroResponse = appropriate ? donation.successResponse : donation.failureResponse;

        this.#state.activeDonation = null;
        if (appropriate) {
            this.#state.stats.donationsAppropriate += 1;
        } else {
            this.#state.stats.donationFailures += 1;
        }

        this.#mutateMetrics(`donation:${instructionId}`, (metrics) => {
            if (appropriate) {
                metrics.stress -= 10;
                metrics.affection += 3;
                metrics.opinion += 7;
                metrics.engagement += 3;
                this.#shiftViewerSentiment(metrics, 'positive', 0.03);
                this.#applyRawEffects(metrics, INSTRUCTION_EFFECTS[instructionId]);
            } else if (donation.tone === 'positive' || donation.tone === 'playful') {
                this.#shiftViewerSentiment(metrics, 'negative', 0.10);
                metrics.opinion -= 8;
                metrics.engagement -= 3;
            } else {
                metrics.stress += 10;
                metrics.affection -= 8;
                metrics.opinion -= 8;
                metrics.engagement += 4;
            }
        });

        this.#emit('donation-resolved', {
            donation,
            instructionId,
            appropriate,
            timedOut: false,
            heroResponse,
            metrics: cloneData(this.#state.metrics)
        });
        this.#recordMoment(
            'donation',
            appropriate
                ? `${donation.author}의 후원에 적절한 방식으로 대응했습니다.`
                : `${donation.author}의 후원에 맞지 않는 지시를 내려 분위기가 흔들렸습니다.`
        );
        this.#endIfEmergency();

        return {
            accepted: true,
            instructionId,
            appropriate,
            heroResponse,
            metrics: cloneData(this.#state.metrics)
        };
    }

    /**
     * 활성 후원의 제한시간 만료 결과를 적용합니다.
     * @returns {object} 시간 초과 처리 결과입니다.
     * @private
     */
    #resolveActiveDonationTimeout() {
        const donation = cloneData(this.#state.activeDonation);
        if (!donation) {
            return { accepted: false, reason: 'NO_ACTIVE_DONATION' };
        }

        this.#state.activeDonation = null;
        this.#state.stats.donationFailures += 1;
        this.#state.stats.donationTimeouts += 1;
        this.#mutateMetrics('donation:timeout', (metrics) => {
            if (donation.tone === 'positive' || donation.tone === 'playful') {
                this.#shiftViewerSentiment(metrics, 'negative', 0.10);
                metrics.opinion -= 8;
                metrics.engagement -= 3;
            } else {
                metrics.stress += 10;
                metrics.affection -= 8;
                metrics.opinion -= 8;
                metrics.engagement += 2;
            }
        });
        this.#emit('donation-resolved', {
            donation,
            instructionId: null,
            appropriate: false,
            timedOut: true,
            heroResponse: donation.timeoutResponse,
            metrics: cloneData(this.#state.metrics)
        });
        this.#recordMoment('donation-timeout', `${donation.author}의 후원에 제한시간 안에 답하지 못했습니다.`);
        this.#endIfEmergency();
        return { accepted: true, timedOut: true, appropriate: false };
    }

    /**
     * 위장 채팅 의도 자체가 방송 전체에 주는 효과를 반영합니다.
     * @param {string} intent - 적용할 의도입니다.
     * @private
     */
    #applyPlayerIntentEffects(intent) {
        this.#mutateMetrics(`player-message:${intent}`, (metrics) => {
            if (intent === 'praise') {
                metrics.stress -= 2;
                metrics.opinion += 8;
                metrics.engagement += 2;
                this.#shiftViewerSentiment(metrics, 'positive', 0.05);
                return;
            }
            if (intent === 'rebuttal') {
                metrics.opinion += 6;
                metrics.engagement += 3;
                this.#shiftViewerSentiment(metrics, 'positive', 0.04);
                return;
            }
            if (intent === 'provocation') {
                metrics.stress += 6;
                metrics.affection -= 2;
                metrics.opinion -= 10;
                metrics.engagement += 15;
                this.#changeViewerTotal(metrics, 5, 0.20);
                this.#shiftViewerSentiment(metrics, 'negative', 0.07);
                return;
            }
            metrics.engagement += 1;
        });
    }

    /**
     * 생성 채팅 하나를 안전한 내부 형태로 정규화합니다.
     * @param {object|string} chat - 외부에서 받은 채팅입니다.
     * @param {string} source - 생성 출처입니다.
     * @returns {object|null} 유효한 일반 채팅 또는 null입니다.
     * @private
     */
    #normalizeGeneratedChat(chat, source) {
        const rawChat = typeof chat === 'string' ? { text: chat } : chat;
        if (!rawChat || typeof rawChat !== 'object') {
            return null;
        }
        if (rawChat.blocked === true || rawChat.safety === 'blocked') {
            return null;
        }

        const text = sanitizeText(rawChat.text, MAX_GENERATED_CHAT_CHARS);
        if (!text) {
            return null;
        }

        const author = sanitizeText(
            rawChat.viewer_id || rawChat.author || rawChat.name || '익명시청자',
            MAX_VIEWER_ID_CHARS
        ) || '익명시청자';
        const sentiment = VALID_SENTIMENTS.has(rawChat.sentiment)
            ? rawChat.sentiment
            : 'neutral';

        return { author, viewer_id: author, text, sentiment, source };
    }

    /**
     * 정규화된 일반 채팅을 피드에 추가합니다.
     * @param {object} chat - 추가할 채팅입니다.
     * @returns {object} ID와 시간 정보가 붙은 채팅입니다.
     * @private
     */
    #appendChat(chat) {
        this.#chatSequence += 1;
        const appended = {
            id: `broadcast-${this.#broadcastSequence}-chat-${this.#chatSequence}`,
            author: chat.author,
            viewer_id: chat.viewer_id || chat.author,
            text: chat.text,
            sentiment: chat.sentiment,
            source: chat.source,
            intent: chat.intent || null,
            masked: chat.masked === true,
            beatId: this.#getCurrentBeat()?.id || null,
            atSeconds: roundSeconds(this.#state.elapsedSeconds)
        };

        this.#state.chats.push(appended);
        if (this.#state.chats.length > this.#maxChatFeed) {
            this.#state.chats.splice(0, this.#state.chats.length - this.#maxChatFeed);
        }
        return appended;
    }

    /**
     * 단순 효과 객체를 수치에 적용하고 변경 이벤트를 만듭니다.
     * @param {string} reason - 변경 이유입니다.
     * @param {object} effects - 적용할 수치 변화입니다.
     * @private
     */
    #applyEffects(reason, effects) {
        if (!effects || Object.keys(effects).length === 0) {
            return;
        }
        this.#mutateMetrics(reason, (metrics) => this.#applyRawEffects(metrics, effects));
    }

    /**
     * 단순 효과 필드를 현재 수치 객체에 더합니다.
     * @param {object} metrics - 변경할 수치 객체입니다.
     * @param {object} effects - 수치 변화 객체입니다.
     * @private
     */
    #applyRawEffects(metrics, effects = {}) {
        if (Number(effects.viewers)) {
            this.#changeViewerTotal(metrics, Number(effects.viewers), effects.positiveShare);
        }
        for (const key of ['stress', 'affection', 'opinion', 'engagement', 'revenue']) {
            if (Number(effects[key])) {
                metrics[key] += Number(effects[key]);
            }
        }
    }

    /**
     * 수치 변경 전후를 캡처하고 `metrics-changed` 이벤트를 발행합니다.
     * @param {string} reason - 변경 이유입니다.
     * @param {Function} mutator - 수치 객체를 직접 변경할 함수입니다.
     * @private
     */
    #mutateMetrics(reason, mutator) {
        const before = cloneData(this.#state.metrics);
        mutator(this.#state.metrics);
        this.#normalizeMetrics(this.#state.metrics);
        const after = cloneData(this.#state.metrics);
        const delta = Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
        const changed = Object.values(delta).some((value) => value !== 0);

        if (changed) {
            this.#emit('metrics-changed', { reason, before, after, delta });
        }
    }

    /**
     * 총 시청자 수를 바꾸면서 긍정·부정 합계 불변식을 유지합니다.
     * @param {object} metrics - 변경할 수치 객체입니다.
     * @param {number} delta - 시청자 증감 수입니다.
     * @param {number|null} [positiveShare=null] - 새 시청자의 긍정 비율입니다.
     * @private
     */
    #changeViewerTotal(metrics, delta, positiveShare = null) {
        const integerDelta = Math.round(Number(delta) || 0);
        if (integerDelta === 0) {
            return;
        }

        if (integerDelta > 0) {
            const currentShare = metrics.viewers > 0 ? metrics.positiveViewers / metrics.viewers : 0.5;
            const share = positiveShare === null || positiveShare === undefined
                ? clamp(currentShare + (metrics.opinion / 500), 0.15, 0.9)
                : clamp(Number(positiveShare), 0, 1);
            const positiveAdded = Math.round(integerDelta * share);
            metrics.viewers += integerDelta;
            metrics.positiveViewers += positiveAdded;
            metrics.negativeViewers += integerDelta - positiveAdded;
            return;
        }

        const removal = Math.min(metrics.viewers, Math.abs(integerDelta));
        const positiveRemoval = metrics.viewers > 0
            ? Math.round(removal * (metrics.positiveViewers / metrics.viewers))
            : 0;
        metrics.viewers -= removal;
        metrics.positiveViewers -= positiveRemoval;
        metrics.negativeViewers -= removal - positiveRemoval;
    }

    /**
     * 일정 비율의 시청자를 반대 성향으로 전환합니다.
     * @param {object} metrics - 변경할 수치 객체입니다.
     * @param {'positive'|'negative'} target - 전환될 목표 성향입니다.
     * @param {number} rate - 출발 집단에서 전환할 0~1 비율입니다.
     * @returns {number} 실제 전환된 시청자 수입니다.
     * @private
     */
    #shiftViewerSentiment(metrics, target, rate) {
        const sourceKey = target === 'positive' ? 'negativeViewers' : 'positiveViewers';
        const targetKey = target === 'positive' ? 'positiveViewers' : 'negativeViewers';
        const sourceCount = Math.max(0, Math.round(metrics[sourceKey] || 0));
        if (sourceCount <= 0) {
            return 0;
        }

        const amount = Math.min(sourceCount, Math.max(1, Math.round(sourceCount * clamp(rate, 0, 1))));
        metrics[sourceKey] -= amount;
        metrics[targetKey] += amount;
        return amount;
    }

    /**
     * 모든 수치를 허용 범위로 제한하고 시청자 합계를 복구합니다.
     * @param {object} metrics - 정규화할 수치 객체입니다.
     * @private
     */
    #normalizeMetrics(metrics) {
        metrics.stress = clamp(Math.round(Number(metrics.stress) || 0), 0, 100);
        metrics.affection = clamp(Math.round(Number(metrics.affection) || 0), 0, 100);
        metrics.opinion = clamp(Math.round(Number(metrics.opinion) || 0), -100, 100);
        metrics.engagement = clamp(Math.round(Number(metrics.engagement) || 0), 0, 100);
        metrics.revenue = Math.max(0, Math.round(Number(metrics.revenue) || 0));
        metrics.viewers = Math.max(0, Math.round(Number(metrics.viewers) || 0));
        metrics.positiveViewers = clamp(
            Math.round(Number(metrics.positiveViewers) || 0),
            0,
            metrics.viewers
        );
        metrics.negativeViewers = metrics.viewers - metrics.positiveViewers;
        metrics.peakViewers = Math.max(
            metrics.viewers,
            Math.round(Number(metrics.peakViewers) || 0)
        );
    }

    /**
     * 방송 경과 시간을 증가시킵니다.
     * @param {number} seconds - 더할 초입니다.
     * @private
     */
    #advanceElapsedTime(seconds) {
        this.#state.elapsedSeconds += Math.max(0, Number(seconds) || 0);
    }

    /**
     * 스트레스가 100에 도달했다면 긴급 종료를 수행합니다.
     * @returns {boolean} 긴급 종료가 발생했는지 여부입니다.
     * @private
     */
    #endIfEmergency() {
        if (this.#state.status !== 'live' || this.#state.metrics.stress < 100) {
            return false;
        }

        this.#recordMoment('emergency', '스트레스가 100에 도달해 방송이 긴급 종료되었습니다.');
        this.#endBroadcast('emergency');
        return true;
    }

    /**
     * 방송을 지정 결과로 끝내고 결과 요약 이벤트를 발행합니다.
     * @param {'normal'|'early'|'emergency'} endType - 종료 유형입니다.
     * @returns {object} 최종 결과 요약입니다.
     * @private
     */
    #endBroadcast(endType) {
        if (this.#state.status !== 'live') {
            return this.#state.result;
        }

        if (this.#state.activeCoreChat) {
            this.#emit('core-chat-cancelled', {
                coreChat: this.#buildPromptSnapshot(this.#state.activeCoreChat),
                reason: endType
            });
        }
        if (this.#state.activeDonation) {
            this.#emit('donation-cancelled', {
                donation: this.#buildPromptSnapshot(this.#state.activeDonation),
                reason: endType
            });
        }

        this.#state.status = 'ended';
        this.#state.endType = endType;
        this.#state.activeCoreChat = null;
        this.#state.activeDonation = null;
        this.#state.beatTimeRemainingSeconds = 0;
        this.#state.currentHeroText = '';
        const summary = this.#buildResultSummary(endType);
        this.#state.result = summary;
        this.#emit('broadcast-ended', { endType, summary: cloneData(summary) });
        return summary;
    }

    /**
     * 최종 수치, 행동 통계, 대표 순간과 히로인 코멘트를 묶습니다.
     * @param {'normal'|'early'|'emergency'} endType - 종료 유형입니다.
     * @returns {object} 결과 화면에서 사용할 요약입니다.
     * @private
     */
    #buildResultSummary(endType) {
        const start = this.#state.startMetrics;
        const final = this.#state.metrics;
        const metricDelta = Object.fromEntries([
            'stress',
            'affection',
            'viewers',
            'positiveViewers',
            'negativeViewers',
            'opinion',
            'engagement',
            'revenue'
        ].map((key) => [key, final[key] - start[key]]));

        return {
            endType,
            topic: this.#getCurrentTopicSummary(),
            durationSeconds: roundSeconds(this.#state.elapsedSeconds),
            completedBeats: this.#state.stats.completedBeats,
            totalBeats: this.#state.topic.beats.length,
            startMetrics: cloneData(start),
            finalMetrics: cloneData(final),
            metricDelta,
            peakViewers: final.peakViewers,
            positiveViewerRatio: final.viewers > 0
                ? Math.round((final.positiveViewers / final.viewers) * 1000) / 10
                : 0,
            coreChats: {
                presented: this.#state.stats.coreChatsPresented,
                resolved: this.#state.stats.coreChatsResolved,
                succeeded: this.#state.stats.coreChatsSucceeded,
                timeouts: this.#state.stats.coreChatTimeouts,
                wrongPositiveKicks: this.#state.stats.wrongPositiveKicks
            },
            moderation: {
                kicksUsed: this.#state.stats.kicksUsed,
                bannedAuthors: [...this.#bannedAuthors]
            },
            playerMessages: {
                used: this.#state.stats.playerMessagesUsed,
                remaining: this.#state.resources.playerMessagesRemaining,
                intents: [...this.#state.stats.playerMessageIntents]
            },
            donations: {
                presented: this.#state.stats.donationsPresented,
                appropriate: this.#state.stats.donationsAppropriate,
                failed: this.#state.stats.donationFailures,
                timeouts: this.#state.stats.donationTimeouts,
                revenue: final.revenue
            },
            majorMoments: cloneData(this.#state.stats.majorMoments.slice(-6)),
            rating: this.#selectResultRating(endType),
            heroComment: this.#selectHeroComment(endType)
        };
    }

    /**
     * 종료 상태와 팬덤 건강도를 바탕으로 결과 유형을 고릅니다.
     * @param {'normal'|'early'|'emergency'} endType - 종료 유형입니다.
     * @returns {string} 결과 유형 식별자입니다.
     * @private
     */
    #selectResultRating(endType) {
        if (endType === 'emergency') return 'emergency-collapse';
        if (endType === 'early') return 'protective-early-end';
        if (this.#state.metrics.stress >= 75 || this.#state.stats.playerMessageIntents.filter((intent) => intent === 'provocation').length >= 2) {
            return 'volatile-growth';
        }
        if (this.#state.metrics.opinion >= 25 && this.#state.metrics.stress <= 45) {
            return 'healthy-community';
        }
        return 'balanced-broadcast';
    }

    /**
     * 최종 스트레스와 플레이 성향에 맞는 히로인의 한마디를 고릅니다.
     * @param {'normal'|'early'|'emergency'} endType - 종료 유형입니다.
     * @returns {string} 결과 화면 코멘트입니다.
     * @private
     */
    #selectHeroComment(endType) {
        if (endType === 'emergency') {
            return '미안해. 지금은 아무 말도 하고 싶지 않아.';
        }
        if (endType === 'early') {
            return this.#state.metrics.affection >= 55
                ? '더 커지기 전에 멈춰줘서 고마워. 오늘은 조금 쉬자.'
                : '갑자기 끝나서 아쉽지만… 지금은 이게 나았을지도 모르겠어.';
        }
        if (this.#state.metrics.stress >= 70) {
            return '사람은 많이 왔는데… 이게 정말 잘된 방송인지는 모르겠어.';
        }
        if (this.#state.stats.playerMessageIntents.includes('provocation')) {
            return '네가 원하는 반응은 얻었겠지. 그런데 다음에도 이렇게 해야 해?';
        }
        return '오늘은 네가 옆에 있다는 느낌이 들었어. 다음에도 같이 해줄 거지?';
    }

    /**
     * 결과 화면에 남길 대표 순간을 최대 여덟 개까지 보존합니다.
     * @param {string} type - 순간 유형입니다.
     * @param {string} text - 사용자에게 보여줄 요약 문장입니다.
     * @private
     */
    #recordMoment(type, text) {
        this.#state.stats.majorMoments.push({
            type,
            text,
            atSeconds: roundSeconds(this.#state.elapsedSeconds)
        });
        if (this.#state.stats.majorMoments.length > 8) {
            this.#state.stats.majorMoments.splice(0, this.#state.stats.majorMoments.length - 8);
        }
    }

    /**
     * 핵심 채팅 처리 결과를 사람이 읽기 쉬운 대표 순간으로 바꿉니다.
     * @param {object} chat - 처리한 핵심 채팅입니다.
     * @param {string} action - 적용한 행동입니다.
     * @param {string} outcome - 기계적 결과입니다.
     * @returns {string} 결과 요약 문장입니다.
     * @private
     */
    #buildCoreMoment(chat, action, outcome) {
        if (outcome === 'positive-wrongly-kicked') return '응원 핵심 채팅 작성자를 잘못 강퇴해 긍정 시청자가 이탈했습니다.';
        if (action === 'kick') return `${chat.author}을 강퇴해 남은 방송에서 다시 등장하지 못하게 했습니다.`;
        if (outcome === 'negative-rebutted') return '부정적 핵심 채팅을 차분하게 반박해 여론을 회복했습니다.';
        if (outcome === 'negative-escalated') return '부정적 채팅을 자극해 논쟁과 스트레스가 커졌습니다.';
        if (outcome === 'positive-recognized' || outcome === 'positive-amplified') return '따뜻한 응원 채팅이 히로인의 긴장을 풀어주었습니다.';
        if (outcome === 'neutral-recognized') return '다른 의견을 강퇴하지 않고 방송의 대화로 받아들였습니다.';
        return `${chat.author}의 핵심 채팅을 ${action} 방식으로 처리했습니다.`;
    }

    /**
     * 위장 채팅 의도를 결과 화면의 대표 순간 문장으로 바꿉니다.
     * @param {string} intent - 사용한 위장 채팅 의도입니다.
     * @returns {string} 결과 요약 문장입니다.
     * @private
     */
    #buildPlayerIntentMoment(intent) {
        if (intent === 'praise') return '칭찬 채팅으로 긍정적인 시청자 분위기를 넓혔습니다.';
        if (intent === 'rebuttal') return '반박·중재 채팅으로 공격적인 여론을 진정시켰습니다.';
        if (intent === 'provocation') return '논쟁을 자극해 참여도와 시청자를 늘리는 대신 팬덤이 거칠어졌습니다.';
        return '중립적인 위장 채팅을 남겼습니다.';
    }

    /**
     * 현재 주제의 선택 화면 요약을 반환합니다.
     * @returns {object|null} 현재 주제 요약입니다.
     * @private
     */
    #getCurrentTopicSummary() {
        if (!this.#state.topic) {
            return null;
        }
        return getAeroLiveTopicSummaries([this.#state.topic], this.#timing)[0];
    }

    /**
     * 현재 비트 콘텐츠를 반환합니다.
     * @returns {object|null} 현재 비트 또는 null입니다.
     * @private
     */
    #getCurrentBeat() {
        return this.#state.topic?.beats?.[this.#state.beatIndex] || null;
    }

    /**
     * 게임 대본에 스트레스별 변형이 있으면 비트 시작 시점 수치로 한 번 선택합니다.
     * @param {object} beat - 시작할 비트입니다.
     * @returns {string} 이번 비트 동안 고정할 히로인 대사입니다.
     * @private
     */
    #resolveHeroText(beat) {
        const variants = beat?.heroVariants;
        if (!variants || typeof variants !== 'object') {
            return beat?.heroText || '';
        }
        const stress = Number(this.#state.metrics?.stress) || 0;
        const band = stress <= 40 ? 'low' : stress <= 80 ? 'medium' : 'high';
        return variants[band] || beat?.heroText || '';
    }

    /**
     * 활성 제한시간 객체를 외부 스냅샷용으로 정리합니다.
     * @param {object|null} prompt - 내부 핵심 채팅 또는 후원 객체입니다.
     * @returns {object|null} 남은 시간이 반올림된 복사본입니다.
     * @private
     */
    #buildPromptSnapshot(prompt) {
        if (!prompt) {
            return null;
        }
        return {
            ...cloneData(prompt),
            timeRemainingSeconds: roundSeconds(prompt.timeRemainingSeconds)
        };
    }

    /**
     * 도메인 이벤트에 순번과 방송 시간을 붙여 큐에 추가합니다.
     * @param {string} type - 이벤트 유형입니다.
     * @param {object} [payload={}] - 이벤트별 데이터입니다.
     * @private
     */
    #emit(type, payload = {}) {
        this.#eventSequence += 1;
        this.#events.push(cloneData({
            type,
            sequence: this.#eventSequence,
            atSeconds: roundSeconds(this.#state.elapsedSeconds),
            ...payload
        }));
    }

    /**
     * 거부된 공개 API 호출을 이벤트와 반환값으로 통일합니다.
     * @param {string} action - 요청한 API 행동입니다.
     * @param {string} reason - 거부 사유 코드입니다.
     * @returns {{accepted:false,action:string,reason:string}} 거부 결과입니다.
     * @private
     */
    #rejectAction(action, reason) {
        this.#emit('action-rejected', { action, reason });
        return { accepted: false, action, reason };
    }

    /**
     * 핵심 런타임 불변식을 검사해 내부 구현 오류를 즉시 드러냅니다.
     * @private
     */
    #assertInvariants() {
        const metrics = this.#state.metrics;
        if (this.#state.activeCoreChat && this.#state.activeDonation) {
            throw new Error('핵심 채팅과 후원은 동시에 활성화될 수 없습니다.');
        }
        if (metrics.positiveViewers + metrics.negativeViewers !== metrics.viewers) {
            throw new Error('긍정·부정 시청자 합계가 전체 시청자 수와 다릅니다.');
        }
        if (metrics.stress < 0 || metrics.stress > 100 || metrics.affection < 0 || metrics.affection > 100) {
            throw new Error('스트레스 또는 호감도가 허용 범위를 벗어났습니다.');
        }
        if (this.#state.resources.kicksRemaining < 0 || this.#state.resources.playerMessagesRemaining < 0) {
            throw new Error('방송 행동 사용 가능 횟수가 음수가 되었습니다.');
        }
        if (this.#state.status === 'ended' && (this.#state.activeCoreChat || this.#state.activeDonation)) {
            throw new Error('종료된 방송에는 활성 제한시간 이벤트가 남을 수 없습니다.');
        }
    }
}
