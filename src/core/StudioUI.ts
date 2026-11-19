import {STUDIO_SETTINGS} from '@/config/settings';
import {EventBus, type HudSnapshot, type RoundSummaryPayload, type StudioToastPayload} from '@/core/EventBus';
import type {GameManager} from '@/core/GameManager';
import type {GameState} from '@/platform/PlatformTypes';
import {STUDIO_ACHIEVEMENTS} from '@/systems/SaveManager';

type ModalId = 'none' | 'settings' | 'platform';

export class StudioUI {
  private readonly root: HTMLElement;
  private readonly gm: GameManager;
  private unsubscribers: Array<() => void> = [];

  private activeModal: ModalId = 'none';
  private bannerVisible = false;
  private confirmResetArmed = false;
  private toastTimer: number | null = null;

  // Секции интерфейса
  private hudEl!: HTMLDivElement;
  private menuEl!: HTMLDivElement;
  private pauseEl!: HTMLDivElement;
  private gameOverEl!: HTMLDivElement;
  private adOverlayEl!: HTMLDivElement;
  private modalEl!: HTMLDivElement;
  private bannerEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private dashBtnEl!: HTMLButtonElement;

  private lastSummary: RoundSummaryPayload | null = null;

  constructor(root: HTMLElement, gameManager: GameManager) {
    this.root = root;
    this.gm = gameManager;
  }

  mount(): void {
    this.root.innerHTML = '';
    this.buildShell();
    this.bindEvents();
    this.syncStateUI(this.gm.getState());
  }

  private buildShell(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'relative w-full h-full flex flex-col justify-between pointer-events-none';

    // Верхний HUD (виден во время игры и паузы)
    this.hudEl = document.createElement('div');
    this.hudEl.className =
      'hidden w-full px-3 sm:px-6 pt-3 sm:pt-4 pointer-events-none transition-opacity duration-150';

    // Главное меню
    this.menuEl = document.createElement('div');
    this.menuEl.className =
      'hidden absolute inset-0 flex items-center justify-center p-4 sm:p-6 pointer-events-auto';

    // Экран паузы
    this.pauseEl = document.createElement('div');
    this.pauseEl.className =
      'hidden absolute inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto z-20';

    // Экран завершения раунда
    this.gameOverEl = document.createElement('div');
    this.gameOverEl.className =
      'hidden absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto z-20';

    // Защитная блокировка при показе рекламы SDK
    this.adOverlayEl = document.createElement('div');
    this.adOverlayEl.className =
      'hidden absolute inset-0 bg-slate-950/90 flex items-center justify-center p-6 pointer-events-auto z-40';
    this.adOverlayEl.innerHTML = `
      <div class="text-center space-y-2">
        <p class="text-base font-semibold text-slate-100">Показ рекламного блока</p>
        <p class="text-sm text-slate-400">Игровой процесс и звук временно приостановлены</p>
      </div>
    `;

    // Модальное окно настроек / платформенных модулей
    this.modalEl = document.createElement('div');
    this.modalEl.className =
      'hidden absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto z-30';

    // Мобильная кнопка рывка (справа внизу, автоматически поднимается над Sticky Banner)
    this.dashBtnEl = document.createElement('button');
    this.dashBtnEl.type = 'button';
    this.dashBtnEl.setAttribute('aria-label', 'Рывок');
    this.dashBtnEl.className =
      'hidden pointer-events-auto fixed right-4 sm:right-6 bottom-5 z-10 h-14 min-w-[104px] px-5 rounded-xl bg-sky-500/90 hover:bg-sky-400 active:scale-95 text-slate-950 font-semibold text-sm shadow-lg shadow-sky-950/40 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 whitespace-nowrap';
    this.dashBtnEl.textContent = 'Рывок';
    this.dashBtnEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      EventBus.emit('game:dash-requested');
    });

    // Резервная зона для Sticky Banner Яндекс Игр (никогда не перекрывает управление)
    this.bannerEl = document.createElement('div');
    this.bannerEl.className =
      'hidden w-full h-14 bg-slate-900/95 border-t border-slate-800 flex items-center justify-center px-4 text-xs text-slate-400 pointer-events-auto shrink-0 z-10';
    this.bannerEl.innerHTML =
      '<span>Зона Sticky Banner Яндекс Игр · управление и HUD автоматически смещены выше</span>';

    // Тост-уведомление
    this.toastEl = document.createElement('div');
    this.toastEl.className =
      'hidden fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl border text-sm font-medium shadow-xl transition-opacity duration-200 pointer-events-none text-center';

    wrapper.appendChild(this.hudEl);
    wrapper.appendChild(this.bannerEl);

    this.root.appendChild(wrapper);
    this.root.appendChild(this.menuEl);
    this.root.appendChild(this.pauseEl);
    this.root.appendChild(this.gameOverEl);
    this.root.appendChild(this.dashBtnEl);
    this.root.appendChild(this.modalEl);
    this.root.appendChild(this.adOverlayEl);
    this.root.appendChild(this.toastEl);
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      EventBus.on('game:state-changed', ({current}) => {
        this.syncStateUI(current);
      }),
      EventBus.on('game:hud-updated', (snapshot) => {
        this.renderHud(snapshot);
      }),
      EventBus.on('game:round-summary', (summary) => {
        this.lastSummary = summary;
        this.renderGameOver(summary);
      }),
      EventBus.on('save:updated', () => {
        if (this.gm.getState() === 'MENU') {
          this.renderMenu();
        }
        if (this.activeModal === 'platform') {
          this.renderModal();
        }
      }),
      EventBus.on('audio:updated', () => {
        if (this.activeModal === 'settings') {
          this.renderModal();
        }
      }),
      EventBus.on('analytics:tracked', () => {
        if (this.activeModal === 'platform') {
          this.renderModal();
        }
      }),
      EventBus.on('ads:state-changed', ({isAdActive}) => {
        this.adOverlayEl.classList.toggle('hidden', !isAdActive);
      }),
      EventBus.on('ads:banner-changed', ({visible}) => {
        this.bannerVisible = visible;
        this.bannerEl.classList.toggle('hidden', !visible);
        this.dashBtnEl.style.bottom = visible ? '4.75rem' : '1.25rem';
        if (this.activeModal === 'platform') {
          this.renderModal();
        }
      }),
      EventBus.on('ui:toast', (toast) => {
        this.showToast(toast);
      }),
      EventBus.on('ui:open-settings', () => {
        this.openModal('settings');
      }),
      EventBus.on('ui:open-platform', () => {
        this.openModal('platform');
      }),
    );
  }

  private syncStateUI(state: GameState): void {
    const isPlaying = state === 'PLAYING';
    const isPaused = state === 'PAUSED';
    const isMenu = state === 'MENU';
    const isGameOver = state === 'GAME_OVER';

    this.menuEl.classList.toggle('hidden', !isMenu);
    this.hudEl.classList.toggle('hidden', !(isPlaying || isPaused));
    this.dashBtnEl.classList.toggle('hidden', !isPlaying);
    this.pauseEl.classList.toggle('hidden', !isPaused);
    this.gameOverEl.classList.toggle('hidden', !isGameOver);

    if (isMenu) {
      this.renderMenu();
    } else if (isPaused) {
      this.renderPause();
    } else if (isGameOver && this.lastSummary) {
      this.renderGameOver(this.lastSummary);
    }
  }

  private renderMenu(): void {
    const save = this.gm.saveManager.getData();
    const bannerOffsetClass = this.bannerVisible ? 'pb-16' : '';

    this.menuEl.innerHTML = `
      <div class="w-full max-w-lg ${bannerOffsetClass}">
        <div class="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div class="space-y-2">
            <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-slate-50">
              ${STUDIO_SETTINGS.gameTitle}
            </h1>
            <p class="text-sm sm:text-base text-slate-300 leading-relaxed">
              Управляйте импульсным ядром, собирайте золотые призмы для комбо и уклоняйтесь от патрульных дронов.
            </p>
          </div>

          <div class="grid grid-cols-3 gap-3 py-3 border-y border-slate-800/90 text-center">
            <div>
              <div class="text-xs text-slate-400">Рекорд</div>
              <div class="text-xl font-bold text-slate-50 tabular-nums mt-0.5">${save.highScore}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">Кристаллы</div>
              <div class="text-xl font-bold text-amber-400 tabular-nums mt-0.5">${save.coins}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">Раундов</div>
              <div class="text-xl font-bold text-slate-50 tabular-nums mt-0.5">${save.gamesPlayed}</div>
            </div>
          </div>

          <div class="space-y-3">
            <button
              id="btn-start-game"
              type="button"
              class="w-full min-h-[48px] px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.99] text-slate-950 font-semibold text-base transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 whitespace-nowrap cursor-pointer"
            >
              Начать игру
            </button>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                id="btn-open-settings"
                type="button"
                class="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm border border-slate-700/80 transition-colors whitespace-nowrap cursor-pointer"
              >
                Настройки звука
              </button>
              <button
                id="btn-open-platform"
                type="button"
                class="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm border border-slate-700/80 transition-colors whitespace-nowrap cursor-pointer"
              >
                Модули и SDK
              </button>
            </div>
          </div>

          <div class="text-xs text-slate-400 leading-relaxed flex flex-wrap items-center justify-between gap-2">
            <span>Управление: мышь, палец или WASD</span>
            <span>Рывок: Пробел / кнопка «Рывок»</span>
          </div>
        </div>
      </div>
    `;

    this.menuEl.querySelector('#btn-start-game')?.addEventListener('click', () => {
      this.gm.startNewGame();
    });
    this.menuEl.querySelector('#btn-open-settings')?.addEventListener('click', () => {
      this.gm.audioManager.playSfx('click');
      this.openModal('settings');
    });
    this.menuEl.querySelector('#btn-open-platform')?.addEventListener('click', () => {
      this.gm.audioManager.playSfx('click');
      this.openModal('platform');
    });
  }

  private renderHud(h: HudSnapshot): void {
    const isMuted = this.gm.audioManager.isMuted();
    const livesItems = Array.from({length: h.maxLives}, (_, i) => {
      const active = i < h.lives;
      return `<span class="inline-block w-2.5 h-2.5 rounded-sm ${active ? 'bg-sky-400' : 'bg-slate-700'}"></span>`;
    }).join('');

    const boosts: string[] = [];
    if (h.hasShield) boosts.push('<span class="text-emerald-400">Щит активен</span>');
    if (h.magnetRemainingMs > 0) {
      boosts.push(`<span class="text-amber-300 tabular-nums">Магнит ${Math.ceil(h.magnetRemainingMs / 1000)}с</span>`);
    }

    const dashPct = Math.round(h.dashReadyRatio * 100);
    this.dashBtnEl.textContent = dashPct >= 100 ? 'Рывок' : `${dashPct}%`;
    this.dashBtnEl.classList.toggle('opacity-60', dashPct < 100);

    this.hudEl.innerHTML = `
      <div class="flex items-start justify-between gap-3 w-full max-w-6xl mx-auto">
        <div class="bg-slate-900/80 backdrop-blur-md border border-slate-800/90 rounded-xl px-3.5 py-2.5 pointer-events-auto">
          <div class="flex items-baseline gap-3 sm:gap-5">
            <div>
              <div class="text-[11px] text-slate-400">Очки</div>
              <div class="text-xl sm:text-2xl font-bold text-slate-50 tabular-nums leading-tight">${h.score}</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-400">Комбо</div>
              <div class="text-base sm:text-lg font-semibold ${h.combo > 1 ? 'text-amber-400' : 'text-slate-300'} tabular-nums leading-tight">x${h.combo}</div>
            </div>
            <div class="hidden sm:block">
              <div class="text-[11px] text-slate-400">Волна</div>
              <div class="text-base sm:text-lg font-semibold text-slate-200 tabular-nums leading-tight">${h.wave}</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-400">Кристаллы</div>
              <div class="text-base sm:text-lg font-semibold text-amber-300 tabular-nums leading-tight">+${h.runCoins}</div>
            </div>
          </div>
          ${boosts.length > 0 ? `<div class="mt-1.5 text-xs flex items-center gap-3">${boosts.join(' · ')}</div>` : ''}
        </div>

        <div class="flex items-center gap-2 pointer-events-auto">
          <div class="hidden sm:flex items-center gap-2 bg-slate-900/80 backdrop-blur-md border border-slate-800/90 rounded-xl px-3 py-2.5 h-[44px]">
            <span class="text-xs text-slate-400">Щиты</span>
            <div class="flex items-center gap-1">${livesItems}</div>
            <span class="text-xs font-semibold text-slate-200 tabular-nums ml-0.5">${h.lives}/${h.maxLives}</span>
          </div>

          <button
            id="hud-btn-mute"
            type="button"
            class="min-h-[44px] px-3.5 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 text-xs sm:text-sm font-medium text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            ${isMuted ? 'Звук: Выкл' : 'Звук: Вкл'}
          </button>

          <button
            id="hud-btn-pause"
            type="button"
            class="min-h-[44px] px-4 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 text-xs sm:text-sm font-semibold text-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            Пауза
          </button>
        </div>
      </div>
    `;

    this.hudEl.querySelector('#hud-btn-mute')?.addEventListener('click', () => {
      this.gm.audioManager.toggleMute();
      this.renderHud(h);
    });
    this.hudEl.querySelector('#hud-btn-pause')?.addEventListener('click', () => {
      this.gm.pauseGame('user');
    });
  }

  private renderPause(): void {
    this.pauseEl.innerHTML = `
      <div class="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
        <div class="space-y-1">
          <h2 class="text-2xl font-bold text-slate-50">Пауза</h2>
          <p class="text-sm text-slate-400">
            Прогресс раунда сохранён · Волна ${this.gm.scoreManager.getWave()} · Очки ${this.gm.scoreManager.getScore()}
          </p>
        </div>

        <div class="space-y-2.5">
          <button
            id="pause-btn-resume"
            type="button"
            class="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap cursor-pointer"
          >
            Продолжить
          </button>
          <button
            id="pause-btn-restart"
            type="button"
            class="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm border border-slate-700/80 transition-colors whitespace-nowrap cursor-pointer"
          >
            Начать заново
          </button>
          <button
            id="pause-btn-settings"
            type="button"
            class="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm border border-slate-700/80 transition-colors whitespace-nowrap cursor-pointer"
          >
            Настройки звука
          </button>
          <button
            id="pause-btn-menu"
            type="button"
            class="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-transparent hover:bg-slate-800 text-slate-300 font-medium text-sm border border-slate-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            Выйти в меню
          </button>
        </div>
      </div>
    `;

    this.pauseEl.querySelector('#pause-btn-resume')?.addEventListener('click', () => {
      this.gm.resumeGame();
    });
    this.pauseEl.querySelector('#pause-btn-restart')?.addEventListener('click', () => {
      this.gm.restartGame();
    });
    this.pauseEl.querySelector('#pause-btn-settings')?.addEventListener('click', () => {
      this.gm.audioManager.playSfx('click');
      this.openModal('settings');
    });
    this.pauseEl.querySelector('#pause-btn-menu')?.addEventListener('click', () => {
      this.gm.returnToMenu();
    });
  }

  private renderGameOver(summary: RoundSummaryPayload): void {
    const achievementsBlock =
      summary.unlockedAchievements.length > 0
        ? `<div class="rounded-xl bg-emerald-950/50 border border-emerald-800/60 px-4 py-3 text-xs text-emerald-300 space-y-1">
            <div class="font-semibold">Открыты достижения:</div>
            <div>${summary.unlockedAchievements
              .map((id) => STUDIO_ACHIEVEMENTS.find((a) => a.id === id)?.title ?? id)
              .join(' · ')}</div>
          </div>`
        : '';

    this.gameOverEl.innerHTML = `
      <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-7 shadow-2xl space-y-5">
        <div class="space-y-1">
          <div class="text-xs text-slate-400">
            Раунд завершён ${summary.isNewRecord ? '· Новый личный рекорд' : ''}
          </div>
          <h2 class="text-2xl sm:text-3xl font-bold text-slate-50 tabular-nums">
            ${summary.score} очков
          </h2>
          <p class="text-sm text-slate-400 tabular-nums">
            Лучший результат: ${summary.highScore} · Достигнута волна ${summary.wave}
          </p>
        </div>

        <div class="grid grid-cols-3 gap-3 py-3 border-y border-slate-800 text-center">
          <div>
            <div class="text-xs text-slate-400">За раунд</div>
            <div class="text-lg font-bold text-amber-400 tabular-nums">+${summary.runCoins}</div>
          </div>
          <div>
            <div class="text-xs text-slate-400">Всего кристаллов</div>
            <div class="text-lg font-bold text-slate-100 tabular-nums">${summary.totalCoins}</div>
          </div>
          <div>
            <div class="text-xs text-slate-400">Макс. комбо</div>
            <div class="text-lg font-bold text-sky-400 tabular-nums">x${summary.maxCombo}</div>
          </div>
        </div>

        ${achievementsBlock}

        <div class="space-y-2.5">
          <button
            id="over-btn-restart"
            type="button"
            class="w-full min-h-[46px] px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm sm:text-base transition-colors whitespace-nowrap cursor-pointer"
          >
            Играть снова
          </button>

          ${
            summary.canRevive
              ? `<button
                  id="over-btn-revive"
                  type="button"
                  class="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-medium text-sm border border-amber-500/40 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Возродиться за видеорекламу (+1 щит)
                </button>`
              : ''
          }

          <button
            id="over-btn-menu"
            type="button"
            class="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700/80 transition-colors whitespace-nowrap cursor-pointer"
          >
            В главное меню
          </button>
        </div>
      </div>
    `;

    this.gameOverEl.querySelector('#over-btn-restart')?.addEventListener('click', () => {
      this.gm.restartGame();
    });
    this.gameOverEl.querySelector('#over-btn-revive')?.addEventListener('click', () => {
      void this.gm.requestReviveWithAd();
    });
    this.gameOverEl.querySelector('#over-btn-menu')?.addEventListener('click', () => {
      this.gm.returnToMenu();
    });
  }

  private openModal(modal: ModalId): void {
    this.activeModal = modal;
    this.confirmResetArmed = false;
    this.modalEl.classList.remove('hidden');
    this.renderModal();
  }

  private closeModal(): void {
    this.activeModal = 'none';
    this.confirmResetArmed = false;
    this.modalEl.classList.add('hidden');
  }

  private renderModal(): void {
    if (this.activeModal === 'settings') {
      this.renderSettingsModal();
    } else if (this.activeModal === 'platform') {
      this.renderPlatformModal();
    }
  }

  private renderSettingsModal(): void {
    const audio = this.gm.audioManager.getSettings();
    const toPct = (v: number) => Math.round(v * 100);

    this.modalEl.innerHTML = `
      <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
        <div class="flex items-center justify-between gap-4">
          <h2 class="text-xl font-bold text-slate-50">Настройки звука</h2>
          <button
            id="modal-close"
            type="button"
            class="min-h-[40px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer"
          >
            Закрыть
          </button>
        </div>

        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4 py-2 border-b border-slate-800">
            <div>
              <div class="text-sm font-medium text-slate-100">Общий звук</div>
              <div class="text-xs text-slate-400">Сохраняется автоматически</div>
            </div>
            <button
              id="audio-toggle-mute"
              type="button"
              class="min-h-[40px] px-4 rounded-lg text-xs font-semibold cursor-pointer ${
                audio.muted
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : 'bg-sky-500 text-slate-950'
              }"
            >
              ${audio.muted ? 'Выключен' : 'Включён'}
            </button>
          </div>

          <label class="block space-y-1.5">
            <div class="flex justify-between text-sm">
              <span class="text-slate-300">Общая громкость</span>
              <span class="text-slate-100 font-medium tabular-nums">${toPct(audio.masterVolume)}%</span>
            </div>
            <input id="range-master" type="range" min="0" max="100" value="${toPct(audio.masterVolume)}" class="w-full accent-sky-400 cursor-pointer" />
          </label>

          <label class="block space-y-1.5">
            <div class="flex justify-between text-sm">
              <span class="text-slate-300">Музыкальный фон</span>
              <span class="text-slate-100 font-medium tabular-nums">${toPct(audio.musicVolume)}%</span>
            </div>
            <input id="range-music" type="range" min="0" max="100" value="${toPct(audio.musicVolume)}" class="w-full accent-sky-400 cursor-pointer" />
          </label>

          <label class="block space-y-1.5">
            <div class="flex justify-between text-sm">
              <span class="text-slate-300">Звуковые эффекты</span>
              <span class="text-slate-100 font-medium tabular-nums">${toPct(audio.sfxVolume)}%</span>
            </div>
            <input id="range-sfx" type="range" min="0" max="100" value="${toPct(audio.sfxVolume)}" class="w-full accent-sky-400 cursor-pointer" />
          </label>
        </div>

        <button
          id="audio-test-sfx"
          type="button"
          class="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm border border-slate-700 cursor-pointer"
        >
          Проверить звуковой эффект
        </button>
      </div>
    `;

    this.modalEl.querySelector('#modal-close')?.addEventListener('click', () => this.closeModal());
    this.modalEl.querySelector('#audio-toggle-mute')?.addEventListener('click', () => {
      this.gm.audioManager.unlockAudio();
      this.gm.audioManager.toggleMute();
    });
    this.modalEl.querySelector('#range-master')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value) / 100;
      this.gm.audioManager.setMasterVolume(val);
    });
    this.modalEl.querySelector('#range-music')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value) / 100;
      this.gm.audioManager.setMusicVolume(val);
    });
    this.modalEl.querySelector('#range-sfx')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value) / 100;
      this.gm.audioManager.setSfxVolume(val);
    });
    this.modalEl.querySelector('#audio-test-sfx')?.addEventListener('click', () => {
      this.gm.audioManager.unlockAudio();
      this.gm.audioManager.playSfx('powerup');
    });
  }

  private renderPlatformModal(): void {
    const caps = this.gm.getPlatformCapabilities();
    const save = this.gm.saveManager.getData();
    const events = this.gm.analyticsManager.getRecentEvents().slice(0, 8);
    const bannerOn = this.gm.getAdsManager().isBannerVisible();

    const achievementsHtml = STUDIO_ACHIEVEMENTS.map((ach) => {
      const unlocked = save.achievements.includes(ach.id);
      return `
        <div class="flex items-center justify-between gap-3 py-1.5 text-xs border-b border-slate-800/70 last:border-0">
          <div>
            <div class="${unlocked ? 'text-slate-100 font-medium' : 'text-slate-400'}">${ach.title}</div>
            <div class="text-slate-500">${ach.description}</div>
          </div>
          <span class="shrink-0 ${unlocked ? 'text-emerald-400 font-medium' : 'text-slate-500'}">
            ${unlocked ? 'Открыто' : 'Закрыто'}
          </span>
        </div>
      `;
    }).join('');

    const eventsHtml =
      events.length > 0
        ? events
            .map((ev) => {
              const t = new Date(ev.timestamp).toLocaleTimeString('ru-RU');
              const params = Object.keys(ev.params).length > 0 ? JSON.stringify(ev.params) : '';
              return `<div class="text-xs font-mono text-slate-300 py-1 border-b border-slate-800/60 last:border-0 break-all">
                <span class="text-slate-500 tabular-nums">${t}</span> · <span class="text-sky-400">${ev.name}</span> ${params ? `<span class="text-slate-400">${params}</span>` : ''}
              </div>`;
            })
            .join('')
        : '<div class="text-xs text-slate-500 py-2">Событий пока нет — запустите раунд.</div>';

    this.modalEl.innerHTML = `
      <div class="w-full max-w-2xl max-h-[88dvh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div class="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800 shrink-0">
          <div>
            <h2 class="text-lg sm:text-xl font-bold text-slate-50">Платформа, реклама и сохранения</h2>
            <p class="text-xs text-slate-400">
              Режим: ${caps.mode === 'yandex' ? 'Yandex Games SDK' : 'Локальный режим (без имитации рекламы)'} · Язык: ${caps.language}
            </p>
          </div>
          <button
            id="modal-close"
            type="button"
            class="min-h-[40px] px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer shrink-0"
          >
            Закрыть
          </button>
        </div>

        <div class="p-6 space-y-6 overflow-y-auto studio-scroll">
          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-slate-200">Проверка рекламных модулей (AdsManager)</h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                id="sdk-test-fullscreen"
                type="button"
                class="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-100 cursor-pointer"
              >
                Тест Fullscreen Ad
              </button>
              <button
                id="sdk-test-rewarded"
                type="button"
                class="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-100 cursor-pointer"
              >
                Тест Rewarded Video
              </button>
              <button
                id="sdk-toggle-banner"
                type="button"
                class="min-h-[44px] px-3.5 py-2 rounded-xl border text-xs font-medium cursor-pointer ${
                  bannerOn
                    ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100'
                }"
              >
                Sticky Banner: ${bannerOn ? 'Вкл' : 'Выкл'}
              </button>
            </div>
            <p class="text-xs text-slate-400">
              Вне Яндекс Игр рекламные методы возвращают безопасный отказ без начисления фиктивных наград.
            </p>
          </section>

          <section class="space-y-2.5">
            <div class="flex items-center justify-between gap-4">
              <h3 class="text-sm font-semibold text-slate-200">Сохранения и достижения (SaveManager)</h3>
              <button
                id="sdk-reset-save"
                type="button"
                class="min-h-[36px] px-3 rounded-lg text-xs font-medium border cursor-pointer ${
                  this.confirmResetArmed
                    ? 'bg-red-500/20 border-red-500/60 text-red-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                }"
              >
                ${this.confirmResetArmed ? 'Подтвердить сброс?' : 'Сбросить прогресс'}
              </button>
            </div>
            <div class="text-xs text-slate-400 tabular-nums">
              Рекорд: ${save.highScore} · Макс. волна: ${save.highestWave} · Кристаллы: ${save.coins} · Облако SDK: ${caps.cloudSavesSupported ? 'Подключено' : 'Ожидает авторизации/SDK'}
            </div>
            <div class="bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2">
              ${achievementsHtml}
            </div>
          </section>

          <section class="space-y-2">
            <h3 class="text-sm font-semibold text-slate-200">События аналитики (AnalyticsManager)</h3>
            <div class="bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2 max-h-44 overflow-y-auto studio-scroll">
              ${eventsHtml}
            </div>
          </section>
        </div>
      </div>
    `;

    this.modalEl.querySelector('#modal-close')?.addEventListener('click', () => this.closeModal());
    this.modalEl.querySelector('#sdk-test-fullscreen')?.addEventListener('click', () => {
      void this.gm.requestTestFullscreenAd('studio_inspector', true);
    });
    this.modalEl.querySelector('#sdk-test-rewarded')?.addEventListener('click', () => {
      void this.gm.requestTestRewardedAd();
    });
    this.modalEl.querySelector('#sdk-toggle-banner')?.addEventListener('click', () => {
      void this.gm.getAdsManager().toggleStickyBanner();
    });
    this.modalEl.querySelector('#sdk-reset-save')?.addEventListener('click', () => {
      if (!this.confirmResetArmed) {
        this.confirmResetArmed = true;
        this.renderPlatformModal();
        return;
      }
      this.gm.saveManager.resetAll();
      this.confirmResetArmed = false;
      EventBus.emit('ui:toast', {
        message: 'Локальные сохранения сброшены.',
        tone: 'info',
      });
      this.renderPlatformModal();
    });
  }

  private showToast(toast: StudioToastPayload): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }

    const toneMap: Record<StudioToastPayload['tone'], string> = {
      info: 'bg-slate-900/95 border-slate-700 text-slate-100',
      success: 'bg-emerald-950/95 border-emerald-700/70 text-emerald-200',
      warning: 'bg-amber-950/95 border-amber-700/70 text-amber-200',
      error: 'bg-red-950/95 border-red-700/70 text-red-200',
    };

    this.toastEl.className = `fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl border text-sm font-medium shadow-xl text-center pointer-events-none ${toneMap[toast.tone]}`;
    this.toastEl.textContent = toast.message;
    this.toastEl.classList.remove('hidden');

    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.add('hidden');
      this.toastTimer = null;
    }, 3400);
  }

  destroy(): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}
