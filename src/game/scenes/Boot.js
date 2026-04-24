import { Scene } from 'phaser';
import { AudioManager } from '../audioManager.js';

export class Boot extends Scene
{
    constructor ()
    {
        super('Boot');
    }

    preload ()
    {
        //  The Boot Scene is typically used to load in any assets you require for your Preloader, such as a game logo or background.
        //  The smaller the file size of the assets, the better, as the Boot Scene itself has no preloader.

        this.load.image('background', 'assets/bg.png');
    }

    create ()
    {
        // Load persisted volume/mute settings from localStorage. No scene
        // reference is stored -- every playSfx/playMusic call passes its
        // own scene, which sidesteps stale-ref issues on scene teardown.
        AudioManager.init();

        this.scene.start('Preloader');
    }
}
