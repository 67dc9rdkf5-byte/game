import {STUDIO_SETTINGS} from '@/config/settings';
import type {SaveManager} from '@/systems/SaveManager';

export class ScoreManager {
  private score = 0;
  private runCoins = 0;
  private combo = 1;
  private maxCombo = 1;
  private lastCollectAt = 0;
  private wave = 1;

  private readonly saveManager: SaveManager;

  constructor(saveManager: SaveManager) {
    this.saveManager = saveManager;
  }

  resetRun(): void {
    this.score = 0;
    this.runCoins = 0;
    this.combo = 1;
    this.maxCombo = 1;
    this.lastCollectAt = 0;
    this.wave = 1;
  }

  addCollectible(basePoints: number, coins: number, nowMs: number): {
    pointsAwarded: number;
    combo: number;
    comboUp: boolean;
    waveAdvanced: boolean;
    newWave: number;
  } {
    const withinCombo =
      this.lastCollectAt > 0 && nowMs - this.lastCollectAt <= STUDIO_SETTINGS.gameplay.comboWindowMs;

    const prevCombo = this.combo;
    this.combo = withinCombo
      ? Math.min(STUDIO_SETTINGS.gameplay.maxComboMultiplier, this.combo + 1)
      : 1;
    this.lastCollectAt = nowMs;
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    if (this.combo >= 5) {
      this.saveManager.unlockAchievement('combo_5');
    }

    const pointsAwarded = basePoints * this.combo;
    this.score += pointsAwarded;
    this.runCoins += coins;

    const targetWave = Math.floor(this.score / STUDIO_SETTINGS.gameplay.waveScoreStep) + 1;
    const waveAdvanced = targetWave > this.wave;
    if (waveAdvanced) {
      this.wave = targetWave;
    }

    return {
      pointsAwarded,
      combo: this.combo,
      comboUp: this.combo > prevCombo,
      waveAdvanced,
      newWave: this.wave,
    };
  }

  tickComboDecay(nowMs: number): boolean {
    if (this.combo > 1 && this.lastCollectAt > 0) {
      if (nowMs - this.lastCollectAt > STUDIO_SETTINGS.gameplay.comboWindowMs) {
        this.combo = 1;
        return true;
      }
    }
    return false;
  }

  getScore(): number {
    return this.score;
  }

  getHighScore(): number {
    return Math.max(this.saveManager.getData().highScore, this.score);
  }

  getRunCoins(): number {
    return this.runCoins;
  }

  getCombo(): number {
    return this.combo;
  }

  getMaxCombo(): number {
    return this.maxCombo;
  }

  getWave(): number {
    return this.wave;
  }
}
