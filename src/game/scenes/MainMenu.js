import { Scene } from 'phaser';

// MainMenu: simple title screen. Click anywhere to begin.
export class MainMenu extends Scene
{
    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        // Plain dark background (no demo logo/image assets).
        this.cameras.main.setBackgroundColor('#1a1a1a');

        // Scene is 1024x768 (see src/game/main.js). Center X = 512.
        const centerX = this.scale.width / 2;

        // Title, centered near the top of the screen.
        this.add.text(centerX, 160, 'SURVIVORS CO-OP', {
            fontFamily: 'Arial Black',
            fontSize: 64,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5);

        // Prompt below the title.
        this.add.text(centerX, 260, 'Click to Start', {
            fontFamily: 'Arial',
            fontSize: 28,
            color: '#cccccc',
            align: 'center'
        }).setOrigin(0.5);

        // Any click starts the gameplay scene.
        this.input.once('pointerdown', () => {
            this.scene.start('Game');
        });
    }
}
