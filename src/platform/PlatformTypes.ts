export type PlatformMode = 'yandex' | 'local';

export type GameState =
  | 'BOOT'
  | 'PRELOAD'
  | 'MENU'
  | 'PLAYING'
  | 'PAUSED'
  | 'AD_PLAYING'
  | 'GAME_OVER';

export interface FullscreenAdResult {
  shown: boolean;
  reason?: 'AD_ACTIVE' | 'COOLDOWN' | 'GAMEPLAY_ACTIVE' | 'LOCAL_MODE' | 'SDK_ERROR';
  error?: unknown;
}

export interface RewardedAdResult {
  rewarded: boolean;
  shown: boolean;
  reason?: 'AD_ACTIVE' | 'LOCAL_MODE' | 'CLOSED_WITHOUT_REWARD' | 'SDK_ERROR';
  error?: unknown;
}

export interface BannerStatusResult {
  stickyAdvIsShowing: boolean;
  reason?: string;
}

// Официальные типы Yandex Games SDK v2
export interface YandexAdvFullscreenCallbacks {
  onOpen?: () => void;
  onClose?: (wasShown: boolean) => void;
  onError?: (error: unknown) => void;
  onOffline?: () => void;
}

export interface YandexAdvRewardedCallbacks {
  onOpen?: () => void;
  onRewarded?: () => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
}

export interface YandexAdv {
  showFullscreenAdv: (options?: {callbacks?: YandexAdvFullscreenCallbacks}) => void;
  showRewardedVideo: (options?: {callbacks?: YandexAdvRewardedCallbacks}) => void;
  getBannerAdvStatus: () => Promise<BannerStatusResult>;
  showBannerAdv: () => Promise<{stickyAdvIsShowing: boolean; reason?: string}>;
  hideBannerAdv: () => Promise<{stickyAdvIsShowing: boolean}>;
}

export interface YandexPlayer {
  isAuthorized?: () => boolean;
  getUniqueID?: () => string;
  getData: (keys?: string[]) => Promise<Record<string, unknown>>;
  setData: (data: Record<string, unknown>, flush?: boolean) => Promise<void>;
}

export interface YandexFeatures {
  LoadingAPI?: {
    ready: () => void;
  };
  GameplayAPI?: {
    start: () => void;
    stop: () => void;
  };
}

export interface YandexEnvironment {
  i18n?: {
    lang?: string;
    tld?: string;
  };
  app?: {
    id?: string;
  };
  payload?: string;
}

export interface YandexGamesSDK {
  adv: YandexAdv;
  features?: YandexFeatures;
  environment?: YandexEnvironment;
  EVENTS?: {
    GAME_API_PAUSE?: string;
    GAME_API_RESUME?: string;
  };
  on?: (eventName: string, callback: () => void) => void;
  off?: (eventName: string, callback: () => void) => void;
  getPlayer?: (options?: {scopes?: boolean}) => Promise<YandexPlayer>;
}

export interface YaGamesGlobal {
  init: (options?: Record<string, unknown>) => Promise<YandexGamesSDK>;
}

declare global {
  interface Window {
    YaGames?: YaGamesGlobal;
    ym?: (id: number, action: string, ...args: unknown[]) => void;
  }
}

export interface PlatformCapabilities {
  mode: PlatformMode;
  sdkAvailable: boolean;
  adsSupported: boolean;
  cloudSavesSupported: boolean;
  language: string;
}
