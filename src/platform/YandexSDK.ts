import type {
  BannerStatusResult,
  FullscreenAdResult,
  PlatformCapabilities,
  RewardedAdResult,
  YandexGamesSDK,
  YandexPlayer,
} from '@/platform/PlatformTypes';

export interface PlatformLifecycleCallbacks {
  onPlatformPause: () => void;
  onPlatformResume: () => void;
}

export class YandexSDK {
  private ysdk: YandexGamesSDK | null = null;
  private player: YandexPlayer | null = null;
  private loadingReadySent = false;
  private gameplayActive = false;
  private pauseHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;

  static isScriptPresent(): boolean {
    return typeof window !== 'undefined' && typeof window.YaGames?.init === 'function';
  }

  async init(callbacks: PlatformLifecycleCallbacks): Promise<boolean> {
    if (!YandexSDK.isScriptPresent() || !window.YaGames) {
      return false;
    }

    try {
      this.ysdk = await window.YaGames.init();
      this.bindLifecycleEvents(callbacks);
      await this.initPlayerSafe();
      return true;
    } catch (err) {
      console.warn('[YandexSDK] Failed to initialize YaGames.init():', err);
      this.ysdk = null;
      return false;
    }
  }

  private bindLifecycleEvents(callbacks: PlatformLifecycleCallbacks): void {
    if (!this.ysdk?.on) return;

    const pauseEvent = this.ysdk.EVENTS?.GAME_API_PAUSE ?? 'game_api_pause';
    const resumeEvent = this.ysdk.EVENTS?.GAME_API_RESUME ?? 'game_api_resume';

    this.pauseHandler = () => {
      this.gameplayStop();
      callbacks.onPlatformPause();
    };
    this.resumeHandler = () => {
      callbacks.onPlatformResume();
    };

    try {
      this.ysdk.on(pauseEvent, this.pauseHandler);
      this.ysdk.on(resumeEvent, this.resumeHandler);
    } catch (err) {
      console.warn('[YandexSDK] Could not subscribe to platform pause/resume events:', err);
    }
  }

  private async initPlayerSafe(): Promise<void> {
    if (!this.ysdk?.getPlayer) return;
    try {
      this.player = await this.ysdk.getPlayer({scopes: false});
    } catch (err) {
      console.warn('[YandexSDK] Player object unavailable (guest or restricted):', err);
      this.player = null;
    }
  }

  getCapabilities(): PlatformCapabilities {
    return {
      mode: 'yandex',
      sdkAvailable: this.ysdk !== null,
      adsSupported: Boolean(this.ysdk?.adv),
      cloudSavesSupported: this.player !== null,
      language: this.ysdk?.environment?.i18n?.lang ?? 'ru',
    };
  }

  getSDKInstance(): YandexGamesSDK | null {
    return this.ysdk;
  }

  loadingReady(): void {
    if (this.loadingReadySent || !this.ysdk) return;
    try {
      this.ysdk.features?.LoadingAPI?.ready();
      this.loadingReadySent = true;
    } catch (err) {
      console.warn('[YandexSDK] LoadingAPI.ready() failed:', err);
    }
  }

  gameplayStart(): void {
    if (!this.ysdk || this.gameplayActive) return;
    try {
      this.ysdk.features?.GameplayAPI?.start();
      this.gameplayActive = true;
    } catch (err) {
      console.warn('[YandexSDK] GameplayAPI.start() failed:', err);
    }
  }

  gameplayStop(): void {
    if (!this.ysdk || !this.gameplayActive) return;
    try {
      this.ysdk.features?.GameplayAPI?.stop();
      this.gameplayActive = false;
    } catch (err) {
      console.warn('[YandexSDK] GameplayAPI.stop() failed:', err);
    }
  }

  showFullscreenAd(hooks?: {onOpen?: () => void}): Promise<FullscreenAdResult> {
    if (!this.ysdk?.adv) {
      return Promise.resolve({shown: false, reason: 'SDK_ERROR'});
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: FullscreenAdResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        this.ysdk!.adv.showFullscreenAdv({
          callbacks: {
            onOpen: () => {
              this.gameplayStop();
              hooks?.onOpen?.();
            },
            onClose: (wasShown: boolean) => {
              finish({shown: wasShown});
            },
            onOffline: () => {
              finish({shown: false, reason: 'SDK_ERROR'});
            },
            onError: (error: unknown) => {
              finish({shown: false, reason: 'SDK_ERROR', error});
            },
          },
        });
      } catch (error) {
        finish({shown: false, reason: 'SDK_ERROR', error});
      }
    });
  }

  showRewardedAd(hooks?: {onOpen?: () => void; onRewarded?: () => void}): Promise<RewardedAdResult> {
    if (!this.ysdk?.adv) {
      return Promise.resolve({rewarded: false, shown: false, reason: 'SDK_ERROR'});
    }

    return new Promise((resolve) => {
      let rewarded = false;
      let opened = false;
      let settled = false;

      const finish = (result: RewardedAdResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        this.ysdk!.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => {
              opened = true;
              this.gameplayStop();
              hooks?.onOpen?.();
            },
            onRewarded: () => {
              rewarded = true;
              hooks?.onRewarded?.();
            },
            onClose: () => {
              finish({
                rewarded,
                shown: opened,
                reason: rewarded ? undefined : 'CLOSED_WITHOUT_REWARD',
              });
            },
            onError: (error: unknown) => {
              finish({
                rewarded: false,
                shown: opened,
                reason: 'SDK_ERROR',
                error,
              });
            },
          },
        });
      } catch (error) {
        finish({rewarded: false, shown: false, reason: 'SDK_ERROR', error});
      }
    });
  }

  async getBannerStatus(): Promise<BannerStatusResult> {
    if (!this.ysdk?.adv?.getBannerAdvStatus) {
      return {stickyAdvIsShowing: false, reason: 'UNAVAILABLE'};
    }
    try {
      return await this.ysdk.adv.getBannerAdvStatus();
    } catch {
      return {stickyAdvIsShowing: false, reason: 'SDK_ERROR'};
    }
  }

  async showBanner(): Promise<boolean> {
    if (!this.ysdk?.adv?.showBannerAdv) return false;
    try {
      const res = await this.ysdk.adv.showBannerAdv();
      return Boolean(res.stickyAdvIsShowing);
    } catch (err) {
      console.warn('[YandexSDK] showBannerAdv() failed:', err);
      return false;
    }
  }

  async hideBanner(): Promise<boolean> {
    if (!this.ysdk?.adv?.hideBannerAdv) return false;
    try {
      const res = await this.ysdk.adv.hideBannerAdv();
      return !res.stickyAdvIsShowing;
    } catch (err) {
      console.warn('[YandexSDK] hideBannerAdv() failed:', err);
      return false;
    }
  }

  async loadCloudData(keys?: string[]): Promise<Record<string, unknown> | null> {
    if (!this.player) return null;
    try {
      return await this.player.getData(keys);
    } catch (err) {
      console.warn('[YandexSDK] player.getData() failed:', err);
      return null;
    }
  }

  async saveCloudData(data: Record<string, unknown>, flush = false): Promise<boolean> {
    if (!this.player) return false;
    try {
      await this.player.setData(data, flush);
      return true;
    } catch (err) {
      console.warn('[YandexSDK] player.setData() failed:', err);
      return false;
    }
  }

  destroy(): void {
    if (!this.ysdk?.off) return;
    const pauseEvent = this.ysdk.EVENTS?.GAME_API_PAUSE ?? 'game_api_pause';
    const resumeEvent = this.ysdk.EVENTS?.GAME_API_RESUME ?? 'game_api_resume';
    if (this.pauseHandler) {
      try {
        this.ysdk.off(pauseEvent, this.pauseHandler);
      } catch {
        // ignore cleanup errors
      }
    }
    if (this.resumeHandler) {
      try {
        this.ysdk.off(resumeEvent, this.resumeHandler);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
