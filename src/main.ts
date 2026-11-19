import './index.css';
import Phaser from 'phaser';
import {createPhaserGameConfig} from '@/core/GameConfig';
import {GameManager} from '@/core/GameManager';
import {StudioUI} from '@/core/StudioUI';

function bootstrapStudio(): void {
  const uiRoot = document.getElementById('ui-root');
  if (!uiRoot) {
    throw new Error('Root element #ui-root not found');
  }

  const gameManager = GameManager.getInstance();
  const ui = new StudioUI(uiRoot, gameManager);
  ui.mount();

  const config = createPhaserGameConfig('game-container');
  const game = new Phaser.Game(config);
  gameManager.setPhaserGame(game);

  window.addEventListener('beforeunload', () => {
    ui.destroy();
    gameManager.destroy();
  });
}

bootstrapStudio();
