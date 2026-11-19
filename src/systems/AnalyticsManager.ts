import {STUDIO_SETTINGS} from '@/config/settings';
import {EventBus} from '@/core/EventBus';

export type AnalyticsEventName =
  | 'game_started'
  | 'game_paused'
  | 'game_resumed'
  | 'level_completed'
  | 'game_over'
  | 'rewarded_ad_requested'
  | 'rewarded_ad_completed'
  | 'fullscreen_ad_requested';

export type AnalyticsParams = Record<string, string | number | boolean>;

export interface AnalyticsRecord {
  id: number;
  name: AnalyticsEventName;
  timestamp: number;
  params: AnalyticsParams;
}

const MAX_SESSION_LOG = 40;

export class AnalyticsManager {
  private records: AnalyticsRecord[] = [];
  private sequence = 0;

  track(name: AnalyticsEventName, params: AnalyticsParams = {}): void {
    const safeParams = this.sanitizeParams(params);
    const record: AnalyticsRecord = {
      id: ++this.sequence,
      name,
      timestamp: Date.now(),
      params: safeParams,
    };

    this.records.unshift(record);
    if (this.records.length > MAX_SESSION_LOG) {
      this.records.length = MAX_SESSION_LOG;
    }

    EventBus.emit('analytics:tracked', record);
    EventBus.emit('analytics:event', {name, params: safeParams});

    this.forwardToExternalAnalytics(name, safeParams);
  }

  getRecentEvents(): readonly AnalyticsRecord[] {
    return this.records;
  }

  clearSessionLog(): void {
    this.records = [];
  }

  private sanitizeParams(params: AnalyticsParams): AnalyticsParams {
    // Никогда не передаём персональные данные пользователей
    const forbiddenKeys = new Set(['email', 'phone', 'name', 'userId', 'ip', 'token']);
    const result: AnalyticsParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (forbiddenKeys.has(key)) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[key] = value;
      }
    }
    return result;
  }

  private forwardToExternalAnalytics(name: AnalyticsEventName, params: AnalyticsParams): void {
    const metrikaId = STUDIO_SETTINGS.yandexMetrikaId;
    if (metrikaId && typeof window !== 'undefined' && typeof window.ym === 'function') {
      try {
        window.ym(metrikaId, 'reachGoal', name, params);
      } catch {
        // Не ломаем игру при сбое внешнего счётчика
      }
    }
  }
}
