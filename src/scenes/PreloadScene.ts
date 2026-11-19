import Phaser from 'phaser';
import {GameManager} from '@/core/GameManager';

export class PreloadScene extends Phaser.Scene {
  private progressBarFill!: Phaser.GameObjects.Graphics;
  private progressWidth = 280;

  constructor() {
    super({key: 'PreloadScene'});
  }

  preload(): void {
    const gm = GameManager.getInstance();
    gm.setState('PRELOAD');

    const {width, height} = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    this.progressWidth = Math.min(320, Math.max(200, width * 0.55));
    const barX = cx - this.progressWidth / 2;
    const barY = cy + 16;

    const title = this.add
      .text(cx, cy - 26, 'AI GAME STUDIO', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5);

    const subtitle = this.add
      .text(cx, cy + 52, 'Подготовка модулей...', {
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        fontSize: '13px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    const barBg = this.add.graphics();
    barBg.fillStyle(0x1e293b, 1);
    barBg.fillRoundedRect(barX, barY, this.progressWidth, 10, 5);

    this.progressBarFill = this.add.graphics();

    this.load.on('progress', (value: number) => {
      this.drawProgress(barX, barY, Math.max(0.15, value));
    });

    this.load.on('complete', () => {
      this.drawProgress(barX, barY, 1);
      title.destroy();
      subtitle.destroy();
      barBg.destroy();
      this.progressBarFill.destroy();
    });

    // Сгенерировать чёткие векторные текстуры в памяти без лишних сетевых запросов
    this.generateStudioTextures();
    this.drawProgress(barX, barY, 1);
  }

  create(): void {
    const gm = GameManager.getInstance();
    gm.notifyGameReady();
    gm.setState('MENU');
    this.scene.start('MenuScene');
  }

  private drawProgress(x: number, y: number, ratio: number): void {
    this.progressBarFill.clear();
    this.progressBarFill.fillStyle(0x38bdf8, 1);
    this.progressBarFill.fillRoundedRect(x, y, Math.max(12, this.progressWidth * ratio), 10, 5);
  }

  private generateStudioTextures(): void {
    // 1. Ядро игрока (Player Core)
    if (!this.textures.exists('player_core')) {
      const g = this.make.graphics({x: 0, y: 0}, false);
      g.fillStyle(0x0284c7, 0.35);
      g.fillCircle(32, 32, 26);
      g.fillStyle(0x38bdf8, 1);
      g.fillCircle(32, 32, 16);
      g.lineStyle(3, 0xe0f2fe, 1);
      g.strokeCircle(32, 32, 16);
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(32, 32, 6);
      g.generateTexture('player_core', 64, 64);
      g.destroy();
    }

    // 2. Энергетическая призма (Energy Prism)
    if (!this.textures.exists('energy_prism')) {
      const prismPoints = [
        new Phaser.Math.Vector2(24, 7),
        new Phaser.Math.Vector2(39, 24),
        new Phaser.Math.Vector2(24, 41),
        new Phaser.Math.Vector2(9, 24),
      ];
      const g = this.make.graphics({x: 0, y: 0}, false);
      g.fillStyle(0xf59e0b, 0.25);
      g.fillCircle(24, 24, 18);
      g.fillStyle(0xfbbf24, 1);
      g.fillPoints(prismPoints, true);
      g.lineStyle(2, 0xfef3c7, 0.95);
      g.strokePoints(prismPoints, true);
      g.generateTexture('energy_prism', 48, 48);
      g.destroy();
    }

    // 3. Бонусный кристалл (Bonus Crystal)
    if (!this.textures.exists('bonus_crystal')) {
      const bonusPoints = [
        new Phaser.Math.Vector2(28, 6),
        new Phaser.Math.Vector2(44, 18),
        new Phaser.Math.Vector2(38, 44),
        new Phaser.Math.Vector2(18, 44),
        new Phaser.Math.Vector2(12, 18),
      ];
      const g = this.make.graphics({x: 0, y: 0}, false);
      g.fillStyle(0x38bdf8, 0.3);
      g.fillCircle(28, 28, 22);
      g.fillStyle(0x7dd3fc, 1);
      g.fillPoints(bonusPoints, true);
      g.lineStyle(2.5, 0xf8fafc, 1);
      g.strokePoints(bonusPoints, true);
      g.generateTexture('bonus_crystal', 56, 56);
      g.destroy();
    }

    // 4. Сфера щита (Shield Orb)
    if (!this.textures.exists('shield_orb')) {
      const g = this.make.graphics({x: 0, y: 0}, false);
      g.fillStyle(0x10b981, 0.28);
      g.fillCircle(24, 24, 20);
      g.lineStyle(3, 0x34d399, 1);
      g.strokeCircle(24, 24, 14);
      g.fillStyle(0x6ee7b7, 1);
      g.fillCircle(24, 24, 6);
      g.generateTexture('shield_orb', 48, 48);
      g.destroy();
    }

    // 5. Сфера магнита (Magnet Orb)
    if (!this.textures.exists('magnet_orb')) {
      const g = this.make.graphics({x: 0, y: 0}, false);
      g.fillStyle(0x6366f1, 0.28);
      g.fillCircle(24, 24, 20);
      g.lineStyle(3, 0xa5b4fc, 1);
      g.strokeCircle(24, 24, 14);
      g.fillStyle(0xe0e7ff, 1);
      g.fillRect(18, 16, 4, 16);
      g.fillRect(26, 16, 4, 16);
      g.generateTexture('magnet_orb', 48, 48);
      g.destroy();
    }

    // 6. Патрульный дрон (Sentinel Hazard)
    if (!this.textures.exists('hazard_drone')) {
      const dronePoints = [
        new Phaser.Math.Vector2(28, 8),
        new Phaser.Math.Vector2(48, 28),
        new Phaser.Math.Vector2(28, 48),
        new Phaser.Math.Vector2(8, 28),
      ];
      const g = this.make.graphics({x: 0, y: 0}, false);
      g.fillStyle(0xef4444, 0.28);
      g.fillCircle(28, 28, 22);
      g.fillStyle(0xdc2626, 1);
      g.fillPoints(dronePoints, true);
      g.lineStyle(2.5, 0xfecaca, 0.95);
      g.strokePoints(dronePoints, true);
      g.fillStyle(0x7f1d1d, 1);
      g.fillCircle(28, 28, 6);
      g.generateTexture('hazard_drone', 56, 56);
      g.destroy();
    }

    // 7. Частица (Particle)
    if (!this.textures.exists('particle_dot')) {
      const g = this.make.graphics({x: 0, y: 0}, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 6);
      g.generateTexture('particle_dot', 16, 16);
      g.destroy();
    }
  }
}
