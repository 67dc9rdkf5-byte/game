import {STUDIO_SETTINGS} from '@/config/settings';
import {EventBus} from '@/core/EventBus';
import type {IPlatformAdapter} from '@/platform/PlatformAdapter';

export interface AudioSettingsSave {
  muted: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

export interface SaveData {
  schemaVersion: number;
  highScore: number;
  highestWave: number;
  gamesPlayed: number;
  coins: number;
  achievements: string[];
  audio: AudioSettingsSave;
  stickyBannerEnabled: boolean;
  updatedAt: number;
}

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
}

export const STUDIO_ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {id: 'first_run', title: 'Первый импульс', description: 'Завершите первый игровой раунд'},
  {id: 'score_300', title: 'Уверенный старт', description: 'Наберите 300 очков за один раунд'},
  {id: 'score_1000', title: 'Мастер арены', description: 'Наберите 1000 очков за один раунд'},
  {id: 'combo_5', title: 'Поток энергии', description: 'Достигните комбо x5'},
  {id: 'wave_4', title: 'Сквозь бурю', description: 'Доберитесь до 4-й волны'},
  {id: 'coins_100', title: 'Коллекционер', description: 'Накопите 100 кристаллов'},
];

function createDefaultSave(): SaveData {
  return {
    schemaVersion: STUDIO_SETTINGS.saveSchemaVersion,
    highScore: 0,
    highestWave: 1,
    gamesPlayed: 0,
    coins: 0,
    achievements: [],
    audio: {
      muted: STUDIO_SETTINGS.audio.muted,
      masterVolume: STUDIO_SETTINGS.audio.masterVolume,
      musicVolume: STUDIO_SETTINGS.audio.musicVolume,
      sfxVolume: STUDIO_SETTINGS.audio.sfxVolume,
    },
    stickyBannerEnabled: false,
    updatedAt: Date.now(),
  };
}

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export class SaveManager {
  private data: SaveData = createDefaultSave();
  private storageAvailable = true;
  private wasCorrupted = false;

  load(): SaveData {
    try {
      const raw = window.localStorage.getItem(STUDIO_SETTINGS.storageKey);
      if (!raw) {
        this.data = createDefaultSave();
        this.save();
        return this.getData();
      }

      const parsed: unknown = JSON.parse(raw);
      const validated = this.validateAndRepair(parsed);
      if (!validated.ok) {
        this.wasCorrupted = true;
        this.backupCorruptedRaw(raw);
        this.data = createDefaultSave();
        this.save();
      } else {
        this.data = validated.data;
      }
    } catch (err) {
      console.warn('[SaveManager] Corrupted or unreadable LocalStorage save, restoring defaults:', err);
      this.wasCorrupted = true;
      this.storageAvailable = this.checkStorageAvailable();
      this.data = createDefaultSave();
      this.save();
    }

    EventBus.emit('save:updated', this.getData());
    return this.getData();
  }

  /**
   * Заготовка для последующего подключения облачных сохранений Яндекс Игр.
   * Выполняет безопасное слияние (берёт максимальный прогресс).
   */
  async syncWithCloud(platform: IPlatformAdapter): Promise<boolean> {
    const caps = platform.getCapabilities();
    if (!caps.cloudSavesSupported) return false;

    const cloudRaw = await platform.loadCloudData();
    if (!cloudRaw || Object.keys(cloudRaw).length === 0) {
      return platform.saveCloudData(this.data as unknown as Record<string, unknown>, false);
    }

    const validated = this.validateAndRepair(cloudRaw);
    if (!validated.ok) {
      return false;
    }

    const cloud = validated.data;
    const mergedAchievements = Array.from(new Set([...this.data.achievements, ...cloud.achievements]));

    this.data = {
      ...this.data,
      highScore: Math.max(this.data.highScore, cloud.highScore),
      highestWave: Math.max(this.data.highestWave, cloud.highestWave),
      gamesPlayed: Math.max(this.data.gamesPlayed, cloud.gamesPlayed),
      coins: Math.max(this.data.coins, cloud.coins),
      achievements: mergedAchievements,
      updatedAt: Date.now(),
    };

    this.save();
    await platform.saveCloudData(this.data as unknown as Record<string, unknown>, false);
    EventBus.emit('save:updated', this.getData());
    return true;
  }

  getData(): SaveData {
    return {
      ...this.data,
      achievements: [...this.data.achievements],
      audio: {...this.data.audio},
    };
  }

  wasSaveCorruptedOnLoad(): boolean {
    return this.wasCorrupted;
  }

  save(): void {
    this.data.updatedAt = Date.now();
    if (this.storageAvailable) {
      try {
        window.localStorage.setItem(STUDIO_SETTINGS.storageKey, JSON.stringify(this.data));
      } catch (err) {
        console.warn('[SaveManager] Could not write to LocalStorage:', err);
      }
    }
    EventBus.emit('save:updated', this.getData());
  }

  updateAudioSettings(patch: Partial<AudioSettingsSave>): void {
    this.data.audio = {
      muted: typeof patch.muted === 'boolean' ? patch.muted : this.data.audio.muted,
      masterVolume: clamp01(patch.masterVolume, this.data.audio.masterVolume),
      musicVolume: clamp01(patch.musicVolume, this.data.audio.musicVolume),
      sfxVolume: clamp01(patch.sfxVolume, this.data.audio.sfxVolume),
    };
    this.save();
  }

  setStickyBannerEnabled(enabled: boolean): void {
    this.data.stickyBannerEnabled = enabled;
    this.save();
  }

  recordRunResult(params: {score: number; wave: number; coinsEarned: number}): {
    isNewRecord: boolean;
    newlyUnlocked: string[];
  } {
    const prevBest = this.data.highScore;
    const isNewRecord = params.score > prevBest;
    if (isNewRecord) {
      this.data.highScore = Math.floor(params.score);
    }
    this.data.highestWave = Math.max(this.data.highestWave, Math.floor(params.wave));
    this.data.gamesPlayed += 1;
    this.data.coins += Math.max(0, Math.floor(params.coinsEarned));

    const newlyUnlocked: string[] = [];
    if (this.unlockAchievement('first_run')) newlyUnlocked.push('first_run');
    if (params.score >= 300 && this.unlockAchievement('score_300')) newlyUnlocked.push('score_300');
    if (params.score >= 1000 && this.unlockAchievement('score_1000')) newlyUnlocked.push('score_1000');
    if (params.wave >= 4 && this.unlockAchievement('wave_4')) newlyUnlocked.push('wave_4');
    if (this.data.coins >= 100 && this.unlockAchievement('coins_100')) newlyUnlocked.push('coins_100');

    this.save();
    return {isNewRecord, newlyUnlocked};
  }

  unlockAchievement(id: string): boolean {
    if (!STUDIO_ACHIEVEMENTS.some((a) => a.id === id)) return false;
    if (this.data.achievements.includes(id)) return false;
    this.data.achievements.push(id);
    this.save();
    return true;
  }

  spendCoins(amount: number): boolean {
    if (amount <= 0 || this.data.coins < amount) return false;
    this.data.coins -= Math.floor(amount);
    this.save();
    return true;
  }

  resetAll(): SaveData {
    this.data = createDefaultSave();
    this.wasCorrupted = false;
    this.save();
    return this.getData();
  }

  private validateAndRepair(input: unknown): {ok: true; data: SaveData} | {ok: false} {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {ok: false};
    }

    const raw = input as Record<string, unknown>;
    const defaults = createDefaultSave();

    // Проверка на заведомо неверные типы ключевых полей
    if (
      (raw.highScore !== undefined && typeof raw.highScore !== 'number') ||
      (raw.coins !== undefined && typeof raw.coins !== 'number')
    ) {
      return {ok: false};
    }

    const rawAudio =
      raw.audio && typeof raw.audio === 'object' && !Array.isArray(raw.audio)
        ? (raw.audio as Record<string, unknown>)
        : {};

    const achievements = Array.isArray(raw.achievements)
      ? raw.achievements.filter((item): item is string => typeof item === 'string')
      : [];

    return {
      ok: true,
      data: {
        schemaVersion: STUDIO_SETTINGS.saveSchemaVersion,
        highScore: nonNegativeInt(raw.highScore, defaults.highScore),
        highestWave: Math.max(1, nonNegativeInt(raw.highestWave, defaults.highestWave)),
        gamesPlayed: nonNegativeInt(raw.gamesPlayed, defaults.gamesPlayed),
        coins: nonNegativeInt(raw.coins, defaults.coins),
        achievements: Array.from(new Set(achievements)),
        audio: {
          muted: typeof rawAudio.muted === 'boolean' ? rawAudio.muted : defaults.audio.muted,
          masterVolume: clamp01(rawAudio.masterVolume, defaults.audio.masterVolume),
          musicVolume: clamp01(rawAudio.musicVolume, defaults.audio.musicVolume),
          sfxVolume: clamp01(rawAudio.sfxVolume, defaults.audio.sfxVolume),
        },
        stickyBannerEnabled:
          typeof raw.stickyBannerEnabled === 'boolean'
            ? raw.stickyBannerEnabled
            : defaults.stickyBannerEnabled,
        updatedAt: nonNegativeInt(raw.updatedAt, Date.now()),
      },
    };
  }

  private backupCorruptedRaw(raw: string): void {
    try {
      window.localStorage.setItem(`${STUDIO_SETTINGS.storageKey}_corrupted_backup`, raw.slice(0, 2000));
    } catch {
      // ignore storage quota errors
    }
  }

  private checkStorageAvailable(): boolean {
    try {
      const testKey = '__studio_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }
}
