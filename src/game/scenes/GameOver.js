import { Scene } from 'phaser';
import { AudioManager } from '../audioManager.js';

export class GameOver extends Scene
{
    constructor ()
    {
        super('GameOver');
    }

    create ()
    {
        this.cameras.main.setBackgroundColor(0xff0000);

        this.add.image(512, 384, 'background').setAlpha(0.5);

        this.add.text(512, 384, 'Game Over', {
            fontFamily: 'Arial Black', fontSize: 64, color: '#ffffff',
            stroke: '#000000', strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5);

        // Fade out the game/boss track and bring the menu theme back in so
        // the death screen doesn't sit under combat music.
        AudioManager.playMusic(this, 'music_menu');

        this.input.once('pointerdown', () => {

            this.scene.start('MainMenu');

        });
    }
}
