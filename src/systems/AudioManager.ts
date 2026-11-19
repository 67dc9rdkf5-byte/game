import {EventBus} from '@/core/EventBus';
import type {AudioSettingsSave, SaveManager} from '@/systems/SaveManager';

export type SoundEffectId =
  | 'click'
  | 'collect'
  | 'combo'
  | 'dash'
  | 'powerup'
  | 'hit'
  | 'wave'
  | 'gameover'
  | 'record';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private muted = false;
  private masterVolume = 0.8;
  private musicVolume = 0.45;
  private sfxVolume = 0.85;
  private suspendedBySystem = false;

  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicPlaying = false;
  private unlocked = false;

  private readonly saveManager: SaveManager;

  constructor(saveManager: SaveManager) {
    this.saveManager = saveManager;
    const saved = saveManager.getData().audio;
    this.muted = saved.muted;
    this.masterVolume = saved.masterVolume;
    this.musicVolume = saved.musicVolume;
    this.sfxVolume = saved.sfxVolume;
  }

  init(): void {
    this.bindBrowserUnlock();
    this.emitAudioState();
  }

  private bindBrowserUnlock(): void {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.unlockAudio();
      if (this.unlocked) {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock, {passive: true});
    window.addEventListener('keydown', unlock, {passive: true});
  }

  unlockAudio(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();

        this.musicGain.connect(this.masterGain);
        this.sfxGain.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
        this.applyGains();
      } catch {
        return;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => {
        this.unlocked = true;
      }).catch(() => {
        // Автовоспроизведение разблокируется при следующем пользовательском жесте
      });
    } else {
      this.unlocked = true;
    }
  }

  getSettings(): AudioSettingsSave {
    return {
      muted: this.muted,
      masterVolume: this.masterVolume,
      musicVolume: this.musicVolume,
      sfxVolume: this.sfxVolume,
    };
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGains();
    this.saveManager.updateAudioSettings({muted});
    this.emitAudioState();
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.applyGains();
    this.saveManager.updateAudioSettings({masterVolume: this.masterVolume});
    this.emitAudioState();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.applyGains();
    this.saveManager.updateAudioSettings({musicVolume: this.musicVolume});
    this.emitAudioState();
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    this.applyGains();
    this.saveManager.updateAudioSettings({sfxVolume: this.sfxVolume});
    this.emitAudioState();
  }

  suspendForSystem(): void {
    this.suspendedBySystem = true;
    this.applyGains();
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  resumeFromSystem(): void {
    this.suspendedBySystem = false;
    this.applyGains();
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  startMusic(): void {
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.musicStep = 0;

    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
    }

    // Мягкий аркадный синтезаторный пульс (не требует внешних mp3 и не вызывает 404)
    const scale = [220, 261.63, 293.66, 329.63, 392.0, 329.63, 293.66, 261.63];
    const bass = [110, 110, 130.81, 130.81, 98.0, 98.0, 146.83, 130.81];

    this.musicTimer = window.setInterval(() => {
      if (!this.musicPlaying || this.muted || this.suspendedBySystem) return;
      if (!this.ctx || !this.musicGain || this.ctx.state !== 'running') return;

      const idx = this.musicStep % scale.length;
      const now = this.ctx.currentTime;

      this.scheduleNote(scale[idx], now, 0.24, 'triangle', 0.14, this.musicGain);
      if (idx % 2 === 0) {
        this.scheduleNote(bass[idx], now, 0.42, 'sine', 0.22, this.musicGain);
      }
      this.musicStep += 1;
    }, 340);
  }

  stopMusic(): void {
    this.musicPlaying = false;
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  playSfx(id: SoundEffectId, pitchBoost = 0): void {
    if (this.muted || this.suspendedBySystem) return;
    this.unlockAudio();
    if (!this.ctx || !this.sfxGain || this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    switch (id) {
      case 'click':
        this.scheduleNote(520, now, 0.06, 'sine', 0.18, this.sfxGain);
        break;
      case 'collect': {
        const base = 520 + Math.min(pitchBoost, 8) * 45;
        this.scheduleNote(base, now, 0.08, 'triangle', 0.22, this.sfxGain);
        this.scheduleNote(base * 1.25, now + 0.045, 0.09, 'sine', 0.18, this.sfxGain);
        break;
      }
      case 'combo':
        this.scheduleNote(660, now, 0.08, 'triangle', 0.22, this.sfxGain);
        this.scheduleNote(880, now + 0.05, 0.12, 'triangle', 0.24, this.sfxGain);
        break;
      case 'dash':
        this.scheduleSweep(440, 180, now, 0.14, 'sawtooth', 0.14, this.sfxGain);
        break;
      case 'powerup':
        this.scheduleNote(440, now, 0.08, 'sine', 0.2, this.sfxGain);
        this.scheduleNote(554.37, now + 0.06, 0.08, 'sine', 0.2, this.sfxGain);
        this.scheduleNote(659.25, now + 0.12, 0.14, 'triangle', 0.24, this.sfxGain);
        break;
      case 'hit':
        this.scheduleSweep(190, 65, now, 0.22, 'sawtooth', 0.3, this.sfxGain);
        break;
      case 'wave':
        this.scheduleNote(392, now, 0.1, 'triangle', 0.2, this.sfxGain);
        this.scheduleNote(523.25, now + 0.09, 0.16, 'triangle', 0.22, this.sfxGain);
        break;
      case 'gameover':
        this.scheduleNote(330, now, 0.15, 'triangle', 0.24, this.sfxGain);
        this.scheduleNote(261.63, now + 0.14, 0.16, 'triangle', 0.22, this.sfxGain);
        this.scheduleNote(196, now + 0.28, 0.3, 'sine', 0.25, this.sfxGain);
        break;
      case 'record':
        this.scheduleNote(523.25, now, 0.09, 'triangle', 0.22, this.sfxGain);
        this.scheduleNote(659.25, now + 0.08, 0.09, 'triangle', 0.22, this.sfxGain);
        this.scheduleNote(783.99, now + 0.16, 0.18, 'triangle', 0.25, this.sfxGain);
        break;
    }
  }

  private scheduleNote(
    freq: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    peakGain: number,
    target: GainNode,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(target);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private scheduleSweep(
    startFreq: number,
    endFreq: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    peakGain: number,
    target: GainNode,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration);

    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(target);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private applyGains(): void {
    if (!this.ctx || !this.masterGain || !this.musicGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const effectiveMaster = this.muted || this.suspendedBySystem ? 0 : this.masterVolume;
    this.masterGain.gain.setTargetAtTime(effectiveMaster, now, 0.02);
    this.musicGain.gain.setTargetAtTime(this.musicVolume, now, 0.02);
    this.sfxGain.gain.setTargetAtTime(this.sfxVolume, now, 0.02);
  }

  private emitAudioState(): void {
    EventBus.emit('audio:updated', this.getSettings());
  }

  destroy(): void {
    this.stopMusic();
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
