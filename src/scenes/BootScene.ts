import Phaser from 'phaser';
import {GameManager} from '@/core/GameManager';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({key: 'BootScene'});
  }

  create(): void {
    const gm = GameManager.getInstance();
    gm.setState('BOOT');

    void gm.initializePlatform().finally(() => {
      if (this.scene.isActive()) {
        this.scene.start('PreloadScene');
      }
    });
  }
}
