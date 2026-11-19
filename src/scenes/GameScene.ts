import Phaser from 'phaser';
import {STUDIO_SETTINGS} from '@/config/settings';
import {EventBus} from '@/core/EventBus';
import {GameManager} from '@/core/GameManager';

interface CollectibleItem {
  sprite: Phaser.GameObjects.Image;
  kind: 'prism' | 'bonus' | 'shield' | 'magnet';
  radius: number;
  bornAt: number;
  ttlMs: number | null;
}

interface HazardDrone {
  sprite: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  radius: number;
  active: boolean;
  telegraphRing: Phaser.GameObjects.Graphics | null;
  activateAt: number;
}

interface ArenaBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export class GameScene extends Phaser.Scene {
  private gm!: GameManager;

  private gridGraphics!: Phaser.GameObjects.Graphics;
  private player!: Phaser.GameObjects.Image;
  private shieldRing!: Phaser.GameObjects.Graphics;
  private waveBannerText!: Phaser.GameObjects.Text;

  private playerVx = 0;
  private playerVy = 0;
  private lives: number = STUDIO_SETTINGS.gameplay.startingLives;
  private hasShield = false;
  private magnetUntil = 0;
  private invulnerableUntil = 0;
  private dashCooldownUntil = 0;
  private dashActiveUntil = 0;
  private usedRevive = false;

  private pointerTarget: {x: number; y: number} | null = null;
  private keys: {
    w?: Phaser.Input.Keyboard.Key;
    a?: Phaser.Input.Keyboard.Key;
    s?: Phaser.Input.Keyboard.Key;
    d?: Phaser.Input.Keyboard.Key;
    up?: Phaser.Input.Keyboard.Key;
    left?: Phaser.Input.Keyboard.Key;
    down?: Phaser.Input.Keyboard.Key;
    right?: Phaser.Input.Keyboard.Key;
    space?: Phaser.Input.Keyboard.Key;
    shift?: Phaser.Input.Keyboard.Key;
    esc?: Phaser.Input.Keyboard.Key;
    p?: Phaser.Input.Keyboard.Key;
  } = {};

  private collectibles: CollectibleItem[] = [];
  private drones: HazardDrone[] = [];
  private nextPrismSpawnAt = 0;
  private nextBonusSpawnAt = 0;
  private nextPowerupSpawnAt = 0;
  private lastHudPushAt = 0;
  private bannerReservePx = 0;

  private unsubscribers: Array<() => void> = [];
  private resizeHandler: ((size: Phaser.Structs.Size) => void) | null = null;

  constructor() {
    super({key: 'GameScene'});
  }

  create(): void {
    this.gm = GameManager.getInstance();
    this.resetInternalState();

    this.gridGraphics = this.add.graphics();

    const bounds = this.getArenaBounds();
    this.player = this.add.image(
      (bounds.left + bounds.right) / 2,
      (bounds.top + bounds.bottom) / 2,
      'player_core',
    );
    this.player.setDepth(10);
    this.player.setScale(0.85);

    this.shieldRing = this.add.graphics();
    this.shieldRing.setDepth(9);

    this.waveBannerText = this.add
      .text(bounds.left + bounds.width / 2, bounds.top + 48, '', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#e0f2fe',
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setAlpha(0);

    this.setupInput();
    this.bindExternalEvents();
    this.drawArenaGrid();

    // Стартовые призмы
    for (let i = 0; i < 4; i++) {
      this.spawnCollectible('prism');
    }
    this.spawnDroneWithTelegraph(0);
    this.spawnDroneWithTelegraph(1);

    this.pushHudSnapshot(true);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  private resetInternalState(): void {
    this.playerVx = 0;
    this.playerVy = 0;
    this.lives = STUDIO_SETTINGS.gameplay.startingLives;
    this.hasShield = false;
    this.magnetUntil = 0;
    this.invulnerableUntil = this.time.now + 900;
    this.dashCooldownUntil = 0;
    this.dashActiveUntil = 0;
    this.usedRevive = false;
    this.pointerTarget = null;
    this.collectibles = [];
    this.drones = [];
    this.nextPrismSpawnAt = this.time.now + 700;
    this.nextBonusSpawnAt = this.time.now + 6500;
    this.nextPowerupSpawnAt = this.time.now + 9000;
    this.lastHudPushAt = 0;
    this.bannerReservePx = this.gm.getAdsManager().isBannerVisible()
      ? STUDIO_SETTINGS.ads.stickyBannerReservePx
      : 0;
  }

  private setupInput(): void {
    if (this.input.keyboard) {
      this.keys = {
        w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        shift: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
        esc: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
        p: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P),
      };
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.gm.audioManager.unlockAudio();
      this.pointerTarget = {x: pointer.worldX, y: pointer.worldY};
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown || !pointer.wasTouch) {
        this.pointerTarget = {x: pointer.worldX, y: pointer.worldY};
      }
    });
  }

  private bindExternalEvents(): void {
    this.unsubscribers.push(
      EventBus.on('game:dash-requested', () => {
        if (this.gm.getState() === 'PLAYING') {
          this.triggerDash();
        }
      }),
      EventBus.on('ads:banner-changed', ({visible}) => {
        this.bannerReservePx = visible ? STUDIO_SETTINGS.ads.stickyBannerReservePx : 0;
        this.drawArenaGrid();
        this.clampPlayerInsideArena();
      }),
      EventBus.on('game:revived', () => {
        this.revivePlayer();
      }),
    );

    this.resizeHandler = () => {
      this.drawArenaGrid();
      this.clampPlayerInsideArena();
      const bounds = this.getArenaBounds();
      this.waveBannerText.setPosition(bounds.left + bounds.width / 2, bounds.top + 48);
    };
    this.scale.on('resize', this.resizeHandler);
  }

  update(time: number, delta: number): void {
    if (this.gm.getState() !== 'PLAYING') return;

    const dt = Math.min(delta, 50) / 1000;

    if (
      (this.keys.esc && Phaser.Input.Keyboard.JustDown(this.keys.esc)) ||
      (this.keys.p && Phaser.Input.Keyboard.JustDown(this.keys.p))
    ) {
      this.gm.pauseGame('user');
      return;
    }

    if (
      (this.keys.space && Phaser.Input.Keyboard.JustDown(this.keys.space)) ||
      (this.keys.shift && Phaser.Input.Keyboard.JustDown(this.keys.shift))
    ) {
      this.triggerDash();
    }

    this.updatePlayerMovement(time, dt);
    this.updateSpawners(time);
    this.updateCollectibles(time, dt);
    this.updateDrones(time, dt);
    this.renderEffects(time);

    const comboDecayed = this.gm.scoreManager.tickComboDecay(time);
    if (comboDecayed || time - this.lastHudPushAt >= 100) {
      this.pushHudSnapshot(false);
    }
  }

  private updatePlayerMovement(time: number, dt: number): void {
    let kx = 0;
    let ky = 0;
    if (this.keys.left?.isDown || this.keys.a?.isDown) kx -= 1;
    if (this.keys.right?.isDown || this.keys.d?.isDown) kx += 1;
    if (this.keys.up?.isDown || this.keys.w?.isDown) ky -= 1;
    if (this.keys.down?.isDown || this.keys.s?.isDown) ky += 1;

    const isDashing = time < this.dashActiveUntil;
    const baseSpeed = isDashing ? 780 : 370;

    if (kx !== 0 || ky !== 0) {
      this.pointerTarget = null;
      const len = Math.hypot(kx, ky);
      const targetVx = (kx / len) * baseSpeed;
      const targetVy = (ky / len) * baseSpeed;
      const accel = isDashing ? 18 : 11;
      this.playerVx = Phaser.Math.Linear(this.playerVx, targetVx, Math.min(1, accel * dt));
      this.playerVy = Phaser.Math.Linear(this.playerVy, targetVy, Math.min(1, accel * dt));
    } else if (this.pointerTarget) {
      const dx = this.pointerTarget.x - this.player.x;
      const dy = this.pointerTarget.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 6) {
        const desiredSpeed = Math.min(baseSpeed, dist * 7.5);
        const targetVx = (dx / dist) * desiredSpeed;
        const targetVy = (dy / dist) * desiredSpeed;
        const accel = isDashing ? 18 : 12;
        this.playerVx = Phaser.Math.Linear(this.playerVx, targetVx, Math.min(1, accel * dt));
        this.playerVy = Phaser.Math.Linear(this.playerVy, targetVy, Math.min(1, accel * dt));
      } else {
        this.playerVx *= 0.82;
        this.playerVy *= 0.82;
      }
    } else {
      this.playerVx *= Math.pow(0.08, dt);
      this.playerVy *= Math.pow(0.08, dt);
    }

    this.player.x += this.playerVx * dt;
    this.player.y += this.playerVy * dt;
    this.clampPlayerInsideArena();

    if (isDashing && Math.random() < 0.65) {
      this.spawnTrailParticle(this.player.x, this.player.y, 0x7dd3fc);
    }

    // Мерцание при неуязвимости
    if (time < this.invulnerableUntil) {
      this.player.setAlpha(Math.sin(time * 0.03) > 0 ? 0.95 : 0.35);
    } else {
      this.player.setAlpha(1);
    }
  }

  private triggerDash(): void {
    const now = this.time.now;
    if (now < this.dashCooldownUntil) return;

    this.dashCooldownUntil = now + STUDIO_SETTINGS.gameplay.dashCooldownMs;
    this.dashActiveUntil = now + STUDIO_SETTINGS.gameplay.dashDurationMs;
    this.invulnerableUntil = Math.max(
      this.invulnerableUntil,
      now + STUDIO_SETTINGS.gameplay.dashDurationMs + 80,
    );

    const speed = Math.hypot(this.playerVx, this.playerVy);
    if (speed > 20) {
      this.playerVx = (this.playerVx / speed) * 760;
      this.playerVy = (this.playerVy / speed) * 760;
    }

    this.gm.audioManager.playSfx('dash');
    this.spawnBurst(this.player.x, this.player.y, 0x38bdf8, 8);
    this.pushHudSnapshot(true);
  }

  private updateSpawners(time: number): void {
    const prismCount = this.collectibles.filter((c) => c.kind === 'prism').length;
    if (prismCount < 5 && time >= this.nextPrismSpawnAt) {
      this.spawnCollectible('prism');
      this.nextPrismSpawnAt = time + 950;
    }

    if (time >= this.nextBonusSpawnAt) {
      this.spawnCollectible('bonus');
      this.nextBonusSpawnAt = time + Phaser.Math.Between(7000, 10500);
    }

    if (time >= this.nextPowerupSpawnAt) {
      const kind = Math.random() < 0.5 ? 'shield' : 'magnet';
      this.spawnCollectible(kind);
      this.nextPowerupSpawnAt = time + Phaser.Math.Between(11000, 15000);
    }

    const desiredDrones = Math.min(10, 2 + Math.floor((this.gm.scoreManager.getWave() - 1) * 1.15));
    if (this.drones.length < desiredDrones) {
      this.spawnDroneWithTelegraph(this.drones.length);
    }
  }

  private updateCollectibles(time: number, dt: number): void {
    const magnetActive = time < this.magnetUntil;
    const isDashing = time < this.dashActiveUntil;
    const pullRadius = magnetActive ? 240 : isDashing ? 130 : 0;

    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      const item = this.collectibles[i];
      item.sprite.rotation += (item.kind === 'bonus' ? 1.8 : 1.1) * dt;

      if (item.ttlMs !== null && time - item.bornAt > item.ttlMs) {
        item.sprite.destroy();
        this.collectibles.splice(i, 1);
        continue;
      }

      const dx = this.player.x - item.sprite.x;
      const dy = this.player.y - item.sprite.y;
      const dist = Math.hypot(dx, dy);

      if (pullRadius > 0 && dist < pullRadius && dist > 1) {
        const pullSpeed = magnetActive ? 420 : 340;
        item.sprite.x += (dx / dist) * pullSpeed * dt;
        item.sprite.y += (dy / dist) * pullSpeed * dt;
      }

      if (dist <= item.radius + 20) {
        this.collectItem(item, time);
        item.sprite.destroy();
        this.collectibles.splice(i, 1);
      }
    }
  }

  private collectItem(item: CollectibleItem, time: number): void {
    if (item.kind === 'prism' || item.kind === 'bonus') {
      const basePoints = item.kind === 'bonus' ? 40 : 10;
      const coins = item.kind === 'bonus' ? 4 : 1;
      const res = this.gm.scoreManager.addCollectible(basePoints, coins, time);

      this.spawnBurst(
        item.sprite.x,
        item.sprite.y,
        item.kind === 'bonus' ? 0x7dd3fc : 0xfbbf24,
        item.kind === 'bonus' ? 12 : 7,
      );
      this.showFloatingScore(item.sprite.x, item.sprite.y, `+${res.pointsAwarded}`);

      if (res.waveAdvanced) {
        this.gm.audioManager.playSfx('wave');
        this.gm.analyticsManager.track('level_completed', {
          completedWave: res.newWave - 1,
          nextWave: res.newWave,
          score: this.gm.scoreManager.getScore(),
        });
        this.showWaveBanner(res.newWave);
      } else if (res.comboUp && res.combo >= 3) {
        this.gm.audioManager.playSfx('combo');
      } else {
        this.gm.audioManager.playSfx('collect', res.combo);
      }
    } else if (item.kind === 'shield') {
      if (!this.hasShield) {
        this.hasShield = true;
      } else if (this.lives < STUDIO_SETTINGS.gameplay.maxLives) {
        this.lives += 1;
      }
      this.gm.audioManager.playSfx('powerup');
      this.spawnBurst(item.sprite.x, item.sprite.y, 0x34d399, 10);
      this.showFloatingScore(item.sprite.x, item.sprite.y, 'Щит!');
    } else if (item.kind === 'magnet') {
      this.magnetUntil = time + 6500;
      this.gm.audioManager.playSfx('powerup');
      this.spawnBurst(item.sprite.x, item.sprite.y, 0xa5b4fc, 10);
      this.showFloatingScore(item.sprite.x, item.sprite.y, 'Магнит!');
    }

    this.pushHudSnapshot(true);
  }

  private updateDrones(time: number, dt: number): void {
    const bounds = this.getArenaBounds();

    for (const drone of this.drones) {
      if (!drone.active) {
        if (time >= drone.activateAt) {
          drone.active = true;
          drone.sprite.setAlpha(1);
          drone.sprite.setScale(0.86);
          drone.telegraphRing?.destroy();
          drone.telegraphRing = null;
        } else if (drone.telegraphRing) {
          const progress = 1 - (drone.activateAt - time) / 1150;
          drone.telegraphRing.clear();
          drone.telegraphRing.lineStyle(2, 0xf87171, 0.35 + progress * 0.55);
          drone.telegraphRing.strokeCircle(
            drone.sprite.x,
            drone.sprite.y,
            26 + (1 - progress) * 18,
          );
        }
        continue;
      }

      drone.sprite.x += drone.vx * dt;
      drone.sprite.y += drone.vy * dt;
      drone.sprite.rotation += 1.6 * dt;

      if (drone.sprite.x - drone.radius < bounds.left) {
        drone.sprite.x = bounds.left + drone.radius;
        drone.vx = Math.abs(drone.vx);
      } else if (drone.sprite.x + drone.radius > bounds.right) {
        drone.sprite.x = bounds.right - drone.radius;
        drone.vx = -Math.abs(drone.vx);
      }

      if (drone.sprite.y - drone.radius < bounds.top) {
        drone.sprite.y = bounds.top + drone.radius;
        drone.vy = Math.abs(drone.vy);
      } else if (drone.sprite.y + drone.radius > bounds.bottom) {
        drone.sprite.y = bounds.bottom - drone.radius;
        drone.vy = -Math.abs(drone.vy);
      }

      if (time >= this.invulnerableUntil) {
        const dist = Math.hypot(this.player.x - drone.sprite.x, this.player.y - drone.sprite.y);
        if (dist <= drone.radius + 15) {
          this.handlePlayerHit(time);
          break;
        }
      }
    }
  }

  private handlePlayerHit(time: number): void {
    this.invulnerableUntil = time + STUDIO_SETTINGS.gameplay.invulnerabilityMs;
    this.cameras.main.shake(180, 0.008);
    this.gm.audioManager.playSfx('hit');
    this.spawnBurst(this.player.x, this.player.y, 0xf87171, 14);

    if (this.hasShield) {
      this.hasShield = false;
      this.showFloatingScore(this.player.x, this.player.y, 'Щит поглотил удар');
      this.pushHudSnapshot(true);
      return;
    }

    this.lives = Math.max(0, this.lives - 1);
    this.pushHudSnapshot(true);

    if (this.lives <= 0) {
      this.scene.pause();
      const canRevive = !this.usedRevive;
      this.gm.completeRound({canRevive});
    }
  }

  private revivePlayer(): void {
    if (this.usedRevive) return;
    this.usedRevive = true;
    this.lives = 1;
    this.invulnerableUntil = this.time.now + 2400;

    // Оттолкнём ближайших дронов от игрока для безопасного продолжения
    for (const drone of this.drones) {
      const dx = drone.sprite.x - this.player.x;
      const dy = drone.sprite.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 160 && dist > 1) {
        drone.sprite.x += (dx / dist) * 140;
        drone.sprite.y += (dy / dist) * 140;
      }
    }

    this.scene.resume();
    this.pushHudSnapshot(true);
  }

  private renderEffects(time: number): void {
    this.shieldRing.clear();

    if (this.hasShield) {
      this.shieldRing.lineStyle(2.5, 0x34d399, 0.85);
      this.shieldRing.strokeCircle(this.player.x, this.player.y, 26);
    }

    if (time < this.magnetUntil) {
      const pulse = 32 + Math.sin(time * 0.01) * 5;
      this.shieldRing.lineStyle(1.5, 0xa5b4fc, 0.55);
      this.shieldRing.strokeCircle(this.player.x, this.player.y, pulse);
    }
  }

  private spawnCollectible(kind: CollectibleItem['kind']): void {
    const pos = this.findSafeSpawnPoint(70);
    const textureMap: Record<CollectibleItem['kind'], string> = {
      prism: 'energy_prism',
      bonus: 'bonus_crystal',
      shield: 'shield_orb',
      magnet: 'magnet_orb',
    };

    const sprite = this.add.image(pos.x, pos.y, textureMap[kind]);
    sprite.setDepth(6);
    sprite.setScale(0.1);
    this.tweens.add({
      targets: sprite,
      scale: kind === 'bonus' ? 0.92 : 0.8,
      duration: 180,
      ease: 'Back.Out',
    });

    this.collectibles.push({
      sprite,
      kind,
      radius: kind === 'bonus' ? 18 : 15,
      bornAt: this.time.now,
      ttlMs: kind === 'prism' ? null : 9500,
    });
  }

  private spawnDroneWithTelegraph(index: number): void {
    const pos = this.findSafeSpawnPoint(165);
    const sprite = this.add.image(pos.x, pos.y, 'hazard_drone');
    sprite.setDepth(8);
    sprite.setAlpha(0.3);
    sprite.setScale(0.65);

    const wave = this.gm.scoreManager.getWave();
    const speed = 115 + Math.min(220, wave * 18 + index * 10);
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);

    const ring = this.add.graphics();
    ring.setDepth(7);

    this.drones.push({
      sprite,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 17,
      active: false,
      telegraphRing: ring,
      activateAt: this.time.now + 1150,
    });
  }

  private findSafeSpawnPoint(minDistanceFromPlayer: number): {x: number; y: number} {
    const bounds = this.getArenaBounds();
    const pad = 34;
    for (let attempt = 0; attempt < 15; attempt++) {
      const x = Phaser.Math.FloatBetween(bounds.left + pad, Math.max(bounds.left + pad + 10, bounds.right - pad));
      const y = Phaser.Math.FloatBetween(bounds.top + pad, Math.max(bounds.top + pad + 10, bounds.bottom - pad));
      if (Math.hypot(x - this.player.x, y - this.player.y) >= minDistanceFromPlayer) {
        return {x, y};
      }
    }
    return {
      x: bounds.left + bounds.width * 0.25,
      y: bounds.top + bounds.height * 0.25,
    };
  }

  private spawnBurst(x: number, y: number, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const dot = this.add.image(x, y, 'particle_dot');
      dot.setTint(color);
      dot.setDepth(12);
      dot.setScale(Phaser.Math.FloatBetween(0.45, 0.85));

      const angle = (i / count) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
      const dist = Phaser.Math.FloatBetween(22, 56);

      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.1,
        duration: 240,
        ease: 'Cubic.Out',
        onComplete: () => dot.destroy(),
      });
    }
  }

  private spawnTrailParticle(x: number, y: number, color: number): void {
    const dot = this.add.image(x, y, 'particle_dot');
    dot.setTint(color);
    dot.setDepth(5);
    dot.setScale(0.75);
    dot.setAlpha(0.55);
    this.tweens.add({
      targets: dot,
      alpha: 0,
      scale: 0.1,
      duration: 180,
      onComplete: () => dot.destroy(),
    });
  }

  private showFloatingScore(x: number, y: number, label: string): void {
    const text = this.add
      .text(x, y - 10, label, {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#fef3c7',
      })
      .setOrigin(0.5)
      .setDepth(15);

    this.tweens.add({
      targets: text,
      y: y - 38,
      alpha: 0,
      duration: 460,
      ease: 'Cubic.Out',
      onComplete: () => text.destroy(),
    });
  }

  private showWaveBanner(wave: number): void {
    const bounds = this.getArenaBounds();
    this.waveBannerText.setPosition(bounds.left + bounds.width / 2, bounds.top + 48);
    this.waveBannerText.setText(`Волна ${wave}`);
    this.waveBannerText.setAlpha(0);
    this.tweens.killTweensOf(this.waveBannerText);
    this.tweens.add({
      targets: this.waveBannerText,
      alpha: 1,
      duration: 180,
      hold: 950,
      yoyo: true,
    });
  }

  private getArenaBounds(): ArenaBounds {
    const {width, height} = this.scale;
    const padX = Math.min(28, width * 0.04);
    const padTop = Math.min(84, Math.max(68, height * 0.1));
    const padBottom = 20 + this.bannerReservePx;

    const left = padX;
    const top = padTop;
    const right = Math.max(left + 200, width - padX);
    const bottom = Math.max(top + 200, height - padBottom);

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  private clampPlayerInsideArena(): void {
    const b = this.getArenaBounds();
    const r = 20;
    this.player.x = Phaser.Math.Clamp(this.player.x, b.left + r, b.right - r);
    this.player.y = Phaser.Math.Clamp(this.player.y, b.top + r, b.bottom - r);
  }

  private drawArenaGrid(): void {
    const {width, height} = this.scale;
    const b = this.getArenaBounds();
    const g = this.gridGraphics;

    g.clear();
    g.fillStyle(0x020617, 1);
    g.fillRect(0, 0, width, height);

    g.fillStyle(0x0b1224, 0.9);
    g.fillRoundedRect(b.left, b.top, b.width, b.height, 14);

    g.lineStyle(1, 0x1e293b, 0.55);
    const step = 56;
    for (let x = b.left + step; x < b.right; x += step) {
      g.lineBetween(x, b.top, x, b.bottom);
    }
    for (let y = b.top + step; y < b.bottom; y += step) {
      g.lineBetween(b.left, y, b.right, y);
    }

    g.lineStyle(1.5, 0x334155, 0.9);
    g.strokeRoundedRect(b.left, b.top, b.width, b.height, 14);
  }

  private pushHudSnapshot(force: boolean): void {
    const now = this.time.now;
    if (!force && now - this.lastHudPushAt < 95) return;
    this.lastHudPushAt = now;

    const remainingCooldown = Math.max(0, this.dashCooldownUntil - now);
    const dashReadyRatio =
      1 - Math.min(1, remainingCooldown / STUDIO_SETTINGS.gameplay.dashCooldownMs);

    EventBus.emit('game:hud-updated', {
      score: this.gm.scoreManager.getScore(),
      highScore: this.gm.scoreManager.getHighScore(),
      coins: this.gm.saveManager.getData().coins,
      runCoins: this.gm.scoreManager.getRunCoins(),
      combo: this.gm.scoreManager.getCombo(),
      lives: this.lives,
      maxLives: STUDIO_SETTINGS.gameplay.maxLives,
      wave: this.gm.scoreManager.getWave(),
      hasShield: this.hasShield,
      magnetRemainingMs: Math.max(0, this.magnetUntil - now),
      dashReadyRatio,
    });
  }

  private cleanup(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    if (this.resizeHandler) {
      this.scale.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    for (const item of this.collectibles) {
      item.sprite.destroy();
    }
    this.collectibles = [];

    for (const drone of this.drones) {
      drone.sprite.destroy();
      drone.telegraphRing?.destroy();
    }
    this.drones = [];
  }
}
