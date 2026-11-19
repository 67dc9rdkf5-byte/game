import Phaser from 'phaser';
import {STUDIO_SETTINGS} from '@/config/settings';
import {BootScene} from '@/scenes/BootScene';
import {GameScene} from '@/scenes/GameScene';
import {MenuScene} from '@/scenes/MenuScene';
import {PreloadScene} from '@/scenes/PreloadScene';

export function createPhaserGameConfig(parentId = 'game-container'): Phaser.Types.Core.GameConfig {
  const width = typeof window !== 'undefined' ? window.innerWidth : STUDIO_SETTINGS.display.baseWidth;
  const height =
    typeof window !== 'undefined' ? window.innerHeight : STUDIO_SETTINGS.display.baseHeight;

  return {
    type: Phaser.AUTO,
    parent: parentId,
    width: Math.max(320, width),
    height: Math.max(320, height),
    backgroundColor: STUDIO_SETTINGS.display.backgroundColor,
    antialias: true,
    roundPixels: false,
    powerPreference: 'high-performance',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%',
    },
    input: {
      activePointers: 3,
      touch: {
        capture: true,
      },
    },
    scene: [BootScene, PreloadScene, MenuScene, GameScene],
  };
}
