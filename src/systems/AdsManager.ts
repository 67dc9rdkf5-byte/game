import {STUDIO_SETTINGS} from '@/config/settings';
import {EventBus} from '@/core/EventBus';
import type {IPlatformAdapter} from '@/platform/PlatformAdapter';
import type {FullscreenAdResult, GameState, RewardedAdResult} from '@/platform/PlatformTypes';
import type {AnalyticsManager} from '@/systems/AnalyticsManager';
import type {AudioManager} from '@/systems/AudioManager';
import type {SaveManager} from '@/systems/SaveManager';

export interface AdsManagerDeps {
  platform: IPlatformAdapter;
  audio: AudioManager;
  analytics: AnalyticsManager;
  saveManager: SaveManager;
  getGameState: () => GameState;
  onAdPauseGame: () => void;
  onAdResumeGame: () => void;
}

export class AdsManager {
  private isAdActive = false;
  private bannerVisible = false;
  private lastFullscreenAt = 0;
  private readonly deps: AdsManagerDeps;

  constructor(deps: AdsManagerDeps) {
    this.deps = deps;
  }

  async init(): Promise<void> {
    const shouldShowBanner = this.deps.saveManager.getData().stickyBannerEnabled;
    if (shouldShowBanner) {
      await this.showStickyBanner();
    } else {
      const status = await this.deps.platform.getBannerStatus();
      this.bannerVisible = status.stickyAdvIsShowing;
      EventBus.emit('ads:banner-changed', {visible: this.bannerVisible});
    }
  }

  isAdPlaying(): boolean {
    return this.isAdActive;
  }

  isBannerVisible(): boolean {
    return this.bannerVisible;
  }

  /**
   * Полноэкранная реклама:
   * - запрещена во время активного геймплея (PLAYING);
   * - запрещена при уже открытой рекламе;
   * - учитывает интервал между показами;
   * - останавливает GameplayAPI и звук на время показа и корректно возвращает состояние.
   */
  async showFullscreen(source: string, bypassCooldown = false): Promise<FullscreenAdResult> {
    if (this.isAdActive) {
      return {shown: false, reason: 'AD_ACTIVE'};
    }

    const currentState = this.deps.getGameState();
    if (!STUDIO_SETTINGS.ads.allowFullscreenDuringGameplay && currentState === 'PLAYING') {
      return {shown: false, reason: 'GAMEPLAY_ACTIVE'};
    }

    const now = Date.now();
    if (!bypassCooldown && now - this.lastFullscreenAt < STUDIO_SETTINGS.ads.fullscreenCooldownMs) {
      return {shown: false, reason: 'COOLDOWN'};
    }

    this.deps.analytics.track('fullscreen_ad_requested', {source});

    if (this.deps.platform.getCapabilities().mode === 'local') {
      return {shown: false, reason: 'LOCAL_MODE'};
    }

    this.isAdActive = true;
    EventBus.emit('ads:state-changed', {isAdActive: true, adType: 'fullscreen'});
    this.deps.platform.gameplayStop();
    this.deps.audio.suspendForSystem();
    this.deps.onAdPauseGame();

    try {
      const result = await this.deps.platform.showFullscreenAd({
        onOpen: () => {
          this.deps.platform.gameplayStop();
          this.deps.audio.suspendForSystem();
        },
      });

      if (result.shown) {
        this.lastFullscreenAt = Date.now();
      }
      return result;
    } finally {
      this.isAdActive = false;
      this.deps.audio.resumeFromSystem();
      this.deps.onAdResumeGame();
      EventBus.emit('ads:state-changed', {isAdActive: false, adType: null});
    }
  }

  /**
   * Видео за вознаграждение (Rewarded Video):
   * - запускается только добровольно по нажатию игрока;
   * - награда выдаётся строго внутри подтверждённого onRewarded;
   * - при ошибке или отсутствии рекламы награда НЕ начисляется.
   */
  async showRewarded(
    rewardTag: string,
    onRewardConfirmed: () => void,
  ): Promise<RewardedAdResult> {
    if (this.isAdActive) {
      return {rewarded: false, shown: false, reason: 'AD_ACTIVE'};
    }

    this.deps.analytics.track('rewarded_ad_requested', {rewardTag});

    if (this.deps.platform.getCapabilities().mode === 'local') {
      return {rewarded: false, shown: false, reason: 'LOCAL_MODE'};
    }

    this.isAdActive = true;
    let rewardGranted = false;

    EventBus.emit('ads:state-changed', {isAdActive: true, adType: 'rewarded'});
    this.deps.platform.gameplayStop();
    this.deps.audio.suspendForSystem();
    this.deps.onAdPauseGame();

    try {
      const result = await this.deps.platform.showRewardedAd({
        onOpen: () => {
          this.deps.platform.gameplayStop();
          this.deps.audio.suspendForSystem();
        },
        onRewarded: () => {
          if (!rewardGranted) {
            rewardGranted = true;
            this.deps.analytics.track('rewarded_ad_completed', {rewardTag});
            onRewardConfirmed();
          }
        },
      });

      return result;
    } finally {
      this.isAdActive = false;
      this.deps.audio.resumeFromSystem();
      this.deps.onAdResumeGame();
      EventBus.emit('ads:state-changed', {isAdActive: false, adType: null});
    }
  }

  async showStickyBanner(): Promise<boolean> {
    const shown = await this.deps.platform.showBanner();
    this.bannerVisible = shown;
    this.deps.saveManager.setStickyBannerEnabled(shown);
    EventBus.emit('ads:banner-changed', {visible: this.bannerVisible});
    return shown;
  }

  async hideStickyBanner(): Promise<boolean> {
    const hidden = await this.deps.platform.hideBanner();
    if (hidden) {
      this.bannerVisible = false;
      this.deps.saveManager.setStickyBannerEnabled(false);
      EventBus.emit('ads:banner-changed', {visible: false});
    }
    return hidden;
  }

  async toggleStickyBanner(): Promise<boolean> {
    if (this.bannerVisible) {
      await this.hideStickyBanner();
    } else {
      await this.showStickyBanner();
    }
    return this.bannerVisible;
  }
}
