import type {GameState} from '@/platform/PlatformTypes';
import type {AnalyticsEventName, AnalyticsRecord} from '@/systems/AnalyticsManager';
import type {SaveData} from '@/systems/SaveManager';

export interface HudSnapshot {
  score: number;
  highScore: number;
  coins: number;
  runCoins: number;
  combo: number;
  lives: number;
  maxLives: number;
  wave: number;
  hasShield: boolean;
  magnetRemainingMs: number;
  dashReadyRatio: number;
}

export interface RoundSummaryPayload {
  score: number;
  highScore: number;
  isNewRecord: boolean;
  runCoins: number;
  totalCoins: number;
  wave: number;
  maxCombo: number;
  canRevive: boolean;
  unlockedAchievements: string[];
}

export interface StudioToastPayload {
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export interface EventMap {
  'game:state-changed': {previous: GameState; current: GameState};
  'game:hud-updated': HudSnapshot;
  'game:round-summary': RoundSummaryPayload;
  'game:revived': undefined;
  'game:dash-requested': undefined;
  'platform:ready': {mode: 'yandex' | 'local'; language: string};
  'platform:pause-requested': undefined;
  'platform:resume-requested': undefined;
  'ads:state-changed': {isAdActive: boolean; adType: 'fullscreen' | 'rewarded' | null};
  'ads:banner-changed': {visible: boolean};
  'save:updated': SaveData;
  'audio:updated': {muted: boolean; masterVolume: number; musicVolume: number; sfxVolume: number};
  'analytics:tracked': AnalyticsRecord;
  'analytics:event': {name: AnalyticsEventName; params?: Record<string, string | number | boolean>};
  'ui:toast': StudioToastPayload;
  'ui:open-settings': undefined;
  'ui:open-platform': undefined;
}

type EventHandler<T> = (payload: T) => void;

class TypedEventBus {
  private listeners = new Map<keyof EventMap, Set<EventHandler<never>>>();

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    const wrapper: EventHandler<EventMap[K]> = (payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as EventHandler<never>);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit<K extends keyof EventMap>(
    event: K,
    ...args: EventMap[K] extends undefined ? [] : [EventMap[K]]
  ): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    const payload = args[0] as EventMap[K];
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<EventMap[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] Error in listener for "${String(event)}":`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const EventBus = new TypedEventBus();
