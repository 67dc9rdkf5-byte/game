export const STUDIO_SETTINGS = {
  studioName: 'AI Game Studio',
  gameId: 'vector-pulse-demo',
  gameTitle: 'Vector Pulse',
  version: '1.0.0',

  // Ключ локального сохранения (уникальный для каждой игры)
  storageKey: 'ai_game_studio_vector_pulse_v1',
  saveSchemaVersion: 1,

  // Базовые настройки масштабирования Phaser
  display: {
    baseWidth: 1280,
    baseHeight: 720,
    backgroundColor: '#020617',
    maxDpr: 2,
  },

  // Настройки звука по умолчанию
  audio: {
    muted: false,
    masterVolume: 0.8,
    musicVolume: 0.45,
    sfxVolume: 0.85,
  },

  // Политика показа рекламы (соблюдение правил Яндекс Игр)
  ads: {
    fullscreenCooldownMs: 65_000,
    allowFullscreenDuringGameplay: false,
    stickyBannerReservePx: 64,
  },

  // Баланс демонстрационной игры
  gameplay: {
    startingLives: 3,
    maxLives: 5,
    comboWindowMs: 2600,
    maxComboMultiplier: 8,
    waveScoreStep: 180,
    dashCooldownMs: 2200,
    dashDurationMs: 210,
    invulnerabilityMs: 1300,
  },

  // Необязательный ID счётчика Яндекс Метрики (если студия захочет подключить в будущем)
  yandexMetrikaId: null as number | null,
} as const;
