import Phaser from 'phaser';
import {GameManager} from '@/core/GameManager';

interface OrbitNode {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  color: number;
}

export class MenuScene extends Phaser.Scene {
  private bgGraphics!: Phaser.GameObjects.Graphics;
  private nodes: OrbitNode[] = [];
  private resizeHandler: ((gameSize: Phaser.Structs.Size) => void) | null = null;

  constructor() {
    super({key: 'MenuScene'});
  }

  create(): void {
    GameManager.getInstance().setState('MENU');
    this.bgGraphics = this.add.graphics();

    this.nodes = Array.from({length: 14}, (_, i) => ({
      angle: (i / 14) * Math.PI * 2,
      radius: 110 + (i % 5) * 65,
      speed: (i % 2 === 0 ? 1 : -1) * (0.22 + (i % 4) * 0.08),
      size: 3 + (i % 3) * 2,
      color: i % 3 === 0 ? 0xf59e0b : 0x38bdf8,
    }));

    this.resizeHandler = () => {
      this.drawBackdrop(this.time.now);
    };
    this.scale.on('resize', this.resizeHandler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.resizeHandler) {
        this.scale.off('resize', this.resizeHandler);
        this.resizeHandler = null;
      }
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    for (const node of this.nodes) {
      node.angle += node.speed * dt;
    }
    this.drawBackdrop(this.time.now);
  }

  private drawBackdrop(_now: number): void {
    const {width, height} = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const g = this.bgGraphics;

    g.clear();
    g.fillStyle(0x020617, 1);
    g.fillRect(0, 0, width, height);

    // Сетка арены
    g.lineStyle(1, 0x1e293b, 0.45);
    const step = 56;
    for (let x = (cx % step) - step; x < width; x += step) {
      g.lineBetween(x, 0, x, height);
    }
    for (let y = (cy % step) - step; y < height; y += step) {
      g.lineBetween(0, y, width, y);
    }

    // Орбитальные кольца студии
    const maxRing = Math.min(width, height) * 0.45;
    g.lineStyle(1, 0x334155, 0.4);
    g.strokeCircle(cx, cy, maxRing * 0.45);
    g.strokeCircle(cx, cy, maxRing * 0.78);
    g.strokeCircle(cx, cy, maxRing);

    for (const node of this.nodes) {
      const scaledR = Math.min(node.radius, maxRing * 1.1);
      const nx = cx + Math.cos(node.angle) * scaledR;
      const ny = cy + Math.sin(node.angle) * scaledR;
      g.fillStyle(node.color, 0.65);
      g.fillCircle(nx, ny, node.size);
    }
  }
}
