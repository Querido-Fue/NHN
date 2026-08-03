const DEFAULT_METRICS = Object.freeze({
    stress: 20,
    affection: 45,
    viewers: 2,
    positiveViewers: 1,
    opinion: 0,
    engagement: 10,
    revenue: 0,
    peakViewers: 2
});

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeMetrics(source = {}) {
    const viewers = Math.max(0, Math.round(Number(source.viewers) || 0));
    const positiveViewers = clamp(
        Math.round(Number(source.positiveViewers) || 0),
        0,
        viewers
    );
    return {
        stress: clamp(Math.round(Number(source.stress) || 0), 0, 100),
        affection: clamp(Math.round(Number(source.affection) || 0), 0, 100),
        viewers,
        positiveViewers,
        negativeViewers: viewers - positiveViewers,
        opinion: clamp(Math.round(Number(source.opinion) || 0), -100, 100),
        engagement: clamp(Math.round(Number(source.engagement) || 0), 0, 100),
        revenue: Math.max(0, Math.round(Number(source.revenue) || 0)),
        peakViewers: Math.max(viewers, Math.round(Number(source.peakViewers) || viewers))
    };
}

/**
 * 여러 방송에 걸쳐 호감도·스트레스·시청자·수익을 이어주는 캠페인 상태입니다.
 * 방송 한 회의 타이머와 판정은 AeroLiveRuntime이 담당하고, 이 객체는 회차 경계만 관리합니다.
 */
export class AeroLiveCampaign {
    /**
     * @param {{initialMetrics?:object,day?:number,lastTopicId?:string|null}} [options={}] - 캠페인 시작값입니다.
     */
    constructor(options = {}) {
        this.day = Math.max(1, Math.round(Number(options.day) || 1));
        this.completedBroadcasts = 0;
        this.lastTopicId = typeof options.lastTopicId === 'string' ? options.lastTopicId : null;
        this.metrics = normalizeMetrics({ ...DEFAULT_METRICS, ...(options.initialMetrics || {}) });
        this.activeBroadcast = null;
        this.stressCrises = 0;
    }

    /**
     * 다음 방송 시작 수치를 만들고 해당 회차를 활성화합니다.
     * 다음 날 스트레스 -10과 같은 주제 재선택 시 시청자 5% 감소를 여기서 한 번만 적용합니다.
     * @param {string} topicId - 선택한 방송 주제입니다.
     * @returns {object} 새 AeroLiveRuntime에 주입할 수치입니다.
     */
    prepareBroadcast(topicId) {
        const safeTopicId = String(topicId || '').trim();
        if (!safeTopicId) {
            throw new TypeError('캠페인 방송 주제 ID가 필요합니다.');
        }
        if (this.activeBroadcast) {
            throw new Error('이미 준비된 캠페인 방송이 있습니다.');
        }

        const prepared = normalizeMetrics(this.metrics);
        if (this.completedBroadcasts > 0) {
            prepared.stress = Math.max(0, prepared.stress - 10);
        }
        if (this.lastTopicId === safeTopicId && prepared.viewers > 0) {
            const previousViewers = prepared.viewers;
            const nextViewers = Math.max(1, Math.floor(previousViewers * 0.95));
            const positiveRatio = previousViewers > 0 ? prepared.positiveViewers / previousViewers : 0.5;
            prepared.viewers = nextViewers;
            prepared.positiveViewers = clamp(Math.round(nextViewers * positiveRatio), 0, nextViewers);
            prepared.negativeViewers = nextViewers - prepared.positiveViewers;
            prepared.peakViewers = Math.max(prepared.peakViewers, nextViewers);
        }

        this.activeBroadcast = { day: this.day, topicId: safeTopicId };
        return clone(prepared);
    }

    /** 방송 시작 실패 시 준비 상태만 되돌립니다. */
    cancelPreparedBroadcast() {
        this.activeBroadcast = null;
    }

    /**
     * 종료 결과를 다음 회차의 영속 수치로 확정합니다.
     * @param {object} result - AeroLiveRuntime 결과 요약입니다.
     * @returns {object} 갱신된 캠페인 스냅샷입니다.
     */
    completeBroadcast(result) {
        if (!this.activeBroadcast) {
            return this.getSnapshot();
        }
        const finalMetrics = result?.finalMetrics;
        if (!finalMetrics || typeof finalMetrics !== 'object') {
            throw new TypeError('캠페인 완료에는 방송 최종 수치가 필요합니다.');
        }

        this.metrics = normalizeMetrics(finalMetrics);
        this.lastTopicId = this.activeBroadcast.topicId;
        this.completedBroadcasts += 1;
        this.day += 1;
        if (result?.endType === 'emergency' || this.metrics.stress >= 100) {
            this.stressCrises += 1;
        }
        this.activeBroadcast = null;
        return this.getSnapshot();
    }

    /** @returns {object} 외부 변경이 내부 상태에 영향을 주지 않는 스냅샷입니다. */
    getSnapshot() {
        return clone({
            day: this.day,
            completedBroadcasts: this.completedBroadcasts,
            lastTopicId: this.lastTopicId,
            metrics: this.metrics,
            activeBroadcast: this.activeBroadcast,
            stressCrises: this.stressCrises,
            recoveryStoryRequired: this.stressCrises === 1 && this.metrics.stress >= 100,
            gameOver: this.stressCrises >= 2 && this.metrics.stress >= 100
        });
    }
}

export const AERO_LIVE_CAMPAIGN_DEFAULT_METRICS = DEFAULT_METRICS;
