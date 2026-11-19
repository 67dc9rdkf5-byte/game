import type {
  BannerStatusResult,
  FullscreenAdResult,
  PlatformCapabilities,
  RewardedAdResult,
} from '@/platform/PlatformTypes';
import {YandexSDK, type PlatformLifecycleCallbacks} from '@/platform/YandexSDK';

export interface IPlatformAdapter {
  init(callbacks: PlatformLifecycleCallbacks): Promise<PlatformCapabilities>;
  getCapabilities(): PlatformCapabilities;
  loadingReady(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  showFullscreenAd(hooks?: {onOpen?: () => void}): Promise<FullscreenAdResult>;
  showRewardedAd(hooks?: {onOpen?: () => void; onRewarded?: () => void}): Promise<RewardedAdResult>;
  getBannerStatus(): Promise<BannerStatusResult>;
  showBanner(): Promise<boolean>;
  hideBanner(): Promise<boolean>;
  loadCloudData(keys?: string[]): Promise<Record<string, unknown> | null>;
  saveCloudData(data: Record<string, unknown>, flush?: boolean): Promise<boolean>;
  destroy(): void;
}

/**
 * Безопасный локальный адаптер.
 * Используется только когда игра запущена вне Яндекс Игр (локальная разработка / предпросмотр).
 * Строго не имитирует фальшивые показы рекламы и не начисляет фиктивные награды.
 */
class LocalPlatformAdapter implements IPlatformAdapter {
  private loadingReadyMarked = false;
  private gameplayRunning = false;
  private bannerVisible = false;

  async init(): Promise<PlatformCapabilities> {
    return this.getCapabilities();
  }

  getCapabilities(): PlatformCapabilities {
    const browserLang =
      typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : 'ru';
    return {
      mode: 'local',
      sdkAvailable: false,
      adsSupported: false,
      cloudSavesSupported: false,
      language: browserLang || 'ru',
    };
  }

  loadingReady(): void {
    if (this.loadingReadyMarked) return;
    this.loadingReadyMarked = true;
  }

  gameplayStart(): void {
    this.gameplayRunning = true;
  }

  gameplayStop(): void {
    if (!this.gameplayRunning) return;
    this.gameplayRunning = false;
  }

  async showFullscreenAd(): Promise<FullscreenAdResult> {
    // Локальный режим не имитирует рекламные показы и доход
    return {shown: false, reason: 'LOCAL_MODE'};
  }

  async showRewardedAd(): Promise<RewardedAdResult> {
    // Локальный режим не выдаёт фиктивные награды за непросмотренную рекламу
    return {rewarded: false, shown: false, reason: 'LOCAL_MODE'};
  }

  async getBannerStatus(): Promise<BannerStatusResult> {
    return {stickyAdvIsShowing: this.bannerVisible, reason: 'LOCAL_MODE'};
  }

  async showBanner(): Promise<boolean> {
    // В локальном режиме только переключаем визуальную безопасную зону баннера для проверки вёрстки
    this.bannerVisible = true;
    return true;
  }

  async hideBanner(): Promise<boolean> {
    this.bannerVisible = false;
    return true;
  }

  async loadCloudData(): Promise<Record<string, unknown> | null> {
    return null;
  }

  async saveCloudData(): Promise<boolean> {
    return false;
  }

  destroy(): void {
    this.gameplayRunning = false;
  }
}

class YandexPlatformAdapter implements IPlatformAdapter {
  private sdk = new YandexSDK();

  async init(callbacks: PlatformLifecycleCallbacks): Promise<PlatformCapabilities> {
    const ok = await this.sdk.init(callbacks);
    if (!ok) {
      throw new Error('Yandex SDK init failed');
    }
    return this.sdk.getCapabilities();
  }

  getCapabilities(): PlatformCapabilities {
    return this.sdk.getCapabilities();
  }

  loadingReady(): void {
    this.sdk.loadingReady();
  }

  gameplayStart(): void {
    this.sdk.gameplayStart();
  }

  gameplayStop(): void {
    this.sdk.gameplayStop();
  }

  showFullscreenAd(hooks?: {onOpen?: () => void}): Promise<FullscreenAdResult> {
    return this.sdk.showFullscreenAd(hooks);
  }

  showRewardedAd(hooks?: {onOpen?: () => void; onRewarded?: () => void}): Promise<RewardedAdResult> {
    return this.sdk.showRewardedAd(hooks);
  }

  getBannerStatus(): Promise<BannerStatusResult> {
    return this.sdk.getBannerStatus();
  }

  showBanner(): Promise<boolean> {
    return this.sdk.showBanner();
  }

  hideBanner(): Promise<boolean> {
    return this.sdk.hideBanner();
  }

  loadCloudData(keys?: string[]): Promise<Record<string, unknown> | null> {
    return this.sdk.loadCloudData(keys);
  }

  saveCloudData(data: Record<string, unknown>, flush?: boolean): Promise<boolean> {
    return this.sdk.saveCloudData(data, flush);
  }

  destroy(): void {
    this.sdk.destroy();
  }
}

export async function createPlatformAdapter(
  callbacks: PlatformLifecycleCallbacks,
): Promise<{adapter: IPlatformAdapter; capabilities: PlatformCapabilities}> {
  if (YandexSDK.isScriptPresent()) {
    const yandexAdapter = new YandexPlatformAdapter();
    try {
      const capabilities = await yandexAdapter.init(callbacks);
      return {adapter: yandexAdapter, capabilities};
    } catch {
      yandexAdapter.destroy();
    }
  }

  const localAdapter = new LocalPlatformAdapter();
  const capabilities = await localAdapter.init();
  return {adapter: localAdapter, capabilities};
}
