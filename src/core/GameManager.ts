import Phaser from 'phaser';
import {STUDIO_SETTINGS} from '@/config/settings';
import {EventBus} from '@/core/EventBus';
import {createPlatformAdapter, type IPlatformAdapter} from '@/platform/PlatformAdapter';
import type {
  FullscreenAdResult,
  GameState,
  PlatformCapabilities,
  RewardedAdResult,
} from '@/platform/PlatformTypes';
import {AdsManager} from '@/systems/AdsManager';
import {AnalyticsManager} from '@/systems/AnalyticsManager';
import {AudioManager} from '@/systems/AudioManager';
import {SaveManager} from '@/systems/SaveManager';
import {ScoreManager} from '@/systems/ScoreManager';

export class GameManager {
  private static instance: GameManager | null = null;

  private game: Phaser.Game | null = null;
  private state: GameState = 'BOOT';
  private stateBeforeAd: GameState | null = null;
  private initialized = false;

  readonly saveManager: SaveManager;
  readonly audioManager: AudioManager;
  readonly scoreManager: ScoreManager;
  readonly analyticsManager: AnalyticsManager;

  private platformAdapter!: IPlatformAdapter;
  private platformCapabilities: PlatformCapabilities = {
    mode: 'local',
    sdkAvailable: false,
    adsSupported: false,
    cloudSavesSupported: false,
    language: 'ru',
  };
  private adsManager!: AdsManager;

  private visibilityHandler: (() => void) | null = null;
  private blurHandler: (() => void) | null = null;
  private pageHideHandler: (() => void) | null = null;

  private constructor() {
    this.saveManager = new SaveManager();
    this.saveManager.load();

    this.audioManager = new AudioManager(this.saveManager);
    this.scoreManager = new ScoreManager(this.saveManager);
    this.analyticsManager = new AnalyticsManager();
  }

  static getInstance(): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  setPhaserGame(game: Phaser.Game): void {
    this.game = game;
  }

  getPhaserGame(): Phaser.Game | null {
    return this.game;
  }

  async initializePlatform(): Promise<PlatformCapabilities> {
    if (this.initialized) {
      return this.platformCapabilities;
    }

    this.audioManager.init();

    const {adapter, capabilities} = await createPlatformAdapter({
      onPlatformPause: () => this.handlePlatformPause(),
      onPlatformResume: () => this.handlePlatformResume(),
    });

    this.platformAdapter = adapter;
    this.platformCapabilities = capabilities;

    this.adsManager = new AdsManager({
      platform: this.platformAdapter,
      audio: this.audioManager,
      analytics: this.analyticsManager,
      saveManager: this.saveManager,
      getGameState: () => this.state,
      onAdPauseGame: () => this.pauseForAd(),
      onAdResumeGame: () => this.resumeAfterAd(),
    });

    await this.adsManager.init();
    await this.saveManager.syncWithCloud(this.platformAdapter);

    this.bindBrowserLifecycle();
    this.initialized = true;

    EventBus.emit('platform:ready', {
      mode: capabilities.mode,
      language: capabilities.language,
    });

    if (this.saveManager.wasSaveCorruptedOnLoad()) {
      EventBus.emit('ui:toast', {
        message: 'Повреждённые сохранения были сброшены и восстановлены.',
        tone: 'warning',
      });
    }

    return capabilities;
  }

  getState(): GameState {
    return this.state;
  }

  setState(next: GameState): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    EventBus.emit('game:state-changed', {previous, current: next});
  }

  getPlatformCapabilities(): PlatformCapabilities {
    return this.platformCapabilities;
  }

  getAdsManager(): AdsManager {
    return this.adsManager;
  }

  notifyGameReady(): void {
    this.platformAdapter?.loadingReady();
  }

  startNewGame(): void {
    if (!this.game || this.adsManager?.isAdPlaying()) return;
    this.audioManager.unlockAudio();
    this.audioManager.playSfx('click');
    this.audioManager.startMusic();

    this.scoreManager.resetRun();
    this.setState('PLAYING');
    this.platformAdapter?.gameplayStart();
    this.analyticsManager.track('game_started', {
      highScore: this.saveManager.getData().highScore,
    });

    const menuScene = this.game.scene.getScene('MenuScene');
    if (menuScene?.scene.isActive()) {
      menuScene.scene.stop();
    }

    const gameScene = this.game.scene.getScene('GameScene');
    if (gameScene) {
      gameScene.scene.restart();
    } else {
      this.game.scene.start('GameScene');
    }
  }

  pauseGame(reason: 'user' | 'blur' | 'platform' = 'user'): void {
    if (this.state !== 'PLAYING' || !this.game) return;
    const gameScene = this.game.scene.getScene('GameScene');
    if (gameScene?.scene.isActive()) {
      gameScene.scene.pause();
    }
    this.platformAdapter?.gameplayStop();
    this.setState('PAUSED');
    this.analyticsManager.track('game_paused', {reason});
    if (reason === 'user') {
      this.audioManager.playSfx('click');
    }
  }

  resumeGame(): void {
    if (this.state !== 'PAUSED' || !this.game || this.adsManager?.isAdPlaying()) return;
    this.audioManager.unlockAudio();
    this.audioManager.playSfx('click');

    const gameScene = this.game.scene.getScene('GameScene');
    if (gameScene?.scene.isPaused()) {
      gameScene.scene.resume();
    }
    this.setState('PLAYING');
    this.platformAdapter?.gameplayStart();
    this.analyticsManager.track('game_resumed');
  }

  restartGame(): void {
    if (this.adsManager?.isAdPlaying()) return;
    this.startNewGame();
  }

  returnToMenu(): void {
    if (!this.game || this.adsManager?.isAdPlaying()) return;
    this.audioManager.playSfx('click');
    this.audioManager.stopMusic();
    this.platformAdapter?.gameplayStop();

    const gameScene = this.game.scene.getScene('GameScene');
    if (gameScene && (gameScene.scene.isActive() || gameScene.scene.isPaused())) {
      gameScene.scene.stop();
    }

    this.setState('MENU');
    this.game.scene.start('MenuScene');

    // Между раундами при возврате в меню можно безопасно запросить полноэкранную рекламу
    void this.tryInterstitialBetweenSessions('return_to_menu');
  }

  completeRound(params: {canRevive: boolean}): void {
    this.platformAdapter?.gameplayStop();
    this.setState('GAME_OVER');

    const score = this.scoreManager.getScore();
    const wave = this.scoreManager.getWave();
    const runCoins = this.scoreManager.getRunCoins();
    const maxCombo = this.scoreManager.getMaxCombo();

    const {isNewRecord, newlyUnlocked} = this.saveManager.recordRunResult({
      score,
      wave,
      coinsEarned: runCoins,
    });

    void this.saveManager.syncWithCloud(this.platformAdapter);

    if (isNewRecord && score > 0) {
      this.audioManager.playSfx('record');
    } else {
      this.audioManager.playSfx('gameover');
    }

    this.analyticsManager.track('game_over', {
      score,
      wave,
      coinsEarned: runCoins,
      maxCombo,
      isNewRecord,
    });

    EventBus.emit('game:round-summary', {
      score,
      highScore: this.saveManager.getData().highScore,
      isNewRecord,
      runCoins,
      totalCoins: this.saveManager.getData().coins,
      wave,
      maxCombo,
      canRevive: params.canRevive,
      unlockedAchievements: newlyUnlocked,
    });
  }

  async requestReviveWithAd(): Promise<boolean> {
    if (this.state !== 'GAME_OVER' || !this.adsManager) return false;

    let rewardedConfirmed = false;
    const result: RewardedAdResult = await this.adsManager.showRewarded('revive_round', () => {
      rewardedConfirmed = true;
    });

    if (rewardedConfirmed && result.rewarded) {
      this.audioManager.playSfx('powerup');
      this.setState('PLAYING');
      this.platformAdapter?.gameplayStart();
      EventBus.emit('game:revived');
      EventBus.emit('ui:toast', {
        message: 'Награда получена! Восстановлен 1 заряд щита.',
        tone: 'success',
      });
      return true;
    }

    if (result.reason === 'LOCAL_MODE') {
      EventBus.emit('ui:toast', {
        message: 'В локальном режиме реклама не имитируется — награда доступна только на Яндекс Играх.',
        tone: 'info',
      });
    } else if (result.reason === 'CLOSED_WITHOUT_REWARD') {
      EventBus.emit('ui:toast', {
        message: 'Просмотр рекламы прерван — награда не начислена.',
        tone: 'warning',
      });
    } else if (result.reason === 'SDK_ERROR') {
      EventBus.emit('ui:toast', {
        message: 'Видео сейчас недоступно. Попробуйте позже.',
        tone: 'warning',
      });
    }

    return false;
  }

  async requestTestFullscreenAd(source = 'manual_test', bypassCooldown = false): Promise<FullscreenAdResult> {
    const res = await this.adsManager.showFullscreen(source, bypassCooldown);
    if (res.reason === 'LOCAL_MODE') {
      EventBus.emit('ui:toast', {
        message: 'Локальный режим: полноэкранная реклама не имитируется вне Яндекс Игр.',
        tone: 'info',
      });
    } else if (res.reason === 'GAMEPLAY_ACTIVE') {
      EventBus.emit('ui:toast', {
        message: 'Полноэкранная реклама заблокирована во время активного геймплея.',
        tone: 'warning',
      });
    } else if (res.reason === 'COOLDOWN') {
      EventBus.emit('ui:toast', {
        message: 'Действует интервал между показами полноэкранной рекламы.',
        tone: 'info',
      });
    } else if (res.shown) {
      EventBus.emit('ui:toast', {
        message: 'Полноэкранная реклама завершена корректно.',
        tone: 'success',
      });
    }
    return res;
  }

  async requestTestRewardedAd(): Promise<RewardedAdResult> {
    let bonusGranted = false;
    const res = await this.adsManager.showRewarded('studio_demo_coins', () => {
      bonusGranted = true;
      const current = this.saveManager.getData();
      this.saveManager.recordRunResult({score: 0, wave: current.highestWave, coinsEarned: 25});
    });

    if (bonusGranted && res.rewarded) {
      EventBus.emit('ui:toast', {
        message: 'Просмотр подтверждён: начислено +25 кристаллов.',
        tone: 'success',
      });
    } else if (res.reason === 'LOCAL_MODE') {
      EventBus.emit('ui:toast', {
        message: 'Локальный режим: фиктивная награда без SDK не выдаётся.',
        tone: 'info',
      });
    } else {
      EventBus.emit('ui:toast', {
        message: 'Реклама не была досмотрена до конца — награда не начислена.',
        tone: 'warning',
      });
    }
    return res;
  }

  private async tryInterstitialBetweenSessions(source: string): Promise<void> {
    if (this.platformCapabilities.mode !== 'yandex') return;
    if (this.saveManager.getData().gamesPlayed < 1) return;
    await this.adsManager.showFullscreen(source, false);
  }

  private pauseForAd(): void {
    this.stateBeforeAd = this.state;
    if (this.state === 'PLAYING' && this.game) {
      const gameScene = this.game.scene.getScene('GameScene');
      if (gameScene?.scene.isActive()) {
        gameScene.scene.pause();
      }
    }
    this.setState('AD_PLAYING');
  }

  private resumeAfterAd(): void {
    const restore = this.stateBeforeAd ?? 'MENU';
    this.stateBeforeAd = null;
    if (restore === 'PLAYING') {
      // Возвращаем игрока на экран паузы, чтобы не было неожиданного удара сразу после закрытия рекламы
      this.setState('PAUSED');
      EventBus.emit('ui:toast', {
        message: 'Реклама закрыта. Нажмите «Продолжить», когда будете готовы.',
        tone: 'info',
      });
    } else {
      this.setState(restore);
    }
  }

  private handlePlatformPause(): void {
    this.audioManager.suspendForSystem();
    if (this.state === 'PLAYING') {
      this.pauseGame('platform');
    }
    EventBus.emit('platform:pause-requested');
  }

  private handlePlatformResume(): void {
    if (!this.adsManager?.isAdPlaying()) {
      this.audioManager.resumeFromSystem();
    }
    EventBus.emit('platform:resume-requested');
  }

  private bindBrowserLifecycle(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.saveManager.save();
        this.audioManager.suspendForSystem();
        if (this.state === 'PLAYING') {
          this.pauseGame('blur');
        }
      } else if (!this.adsManager?.isAdPlaying()) {
        this.audioManager.resumeFromSystem();
      }
    };

    this.blurHandler = () => {
      this.saveManager.save();
      if (this.state === 'PLAYING') {
        this.pauseGame('blur');
      }
    };

    this.pageHideHandler = () => {
      this.saveManager.save();
      this.platformAdapter?.gameplayStop();
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('blur', this.blurHandler);
    window.addEventListener('pagehide', this.pageHideHandler);
  }

  destroy(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler);
    }
    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
    }
    this.platformAdapter?.destroy();
    this.audioManager.destroy();
    this.game?.destroy(true);
    this.game = null;
    EventBus.clear();
  }
}

export {STUDIO_SETTINGS};
