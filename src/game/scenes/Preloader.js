import { Scene } from 'phaser';

export class Preloader extends Scene
{
    constructor ()
    {
        super('Preloader');
    }

    init ()
    {
        //  We loaded this image in our Boot Scene, so we can display it here
        this.add.image(512, 384, 'background');

        //  A simple progress bar. This is the outline of the bar.
        this.add.rectangle(512, 384, 468, 32).setStrokeStyle(1, 0xffffff);

        //  This is the progress bar itself. It will increase in size from the left based on the % of progress.
        const bar = this.add.rectangle(512-230, 384, 4, 28, 0xffffff);

        //  Use the 'progress' event emitted by the LoaderPlugin to update the loading bar
        this.load.on('progress', (progress) => {

            //  Update the progress bar (our bar is 464px wide, so 100% = 464px)
            bar.width = 4 + (460 * progress);

        });
    }

    preload ()
    {
        //  Load the assets for the game - Replace with your own assets
        this.load.setPath('assets');

        this.load.image('logo', 'logo.png');

        // Audio.
        // Keys intentionally match the filenames (minus extension) so the
        // cache-key used by AudioManager is predictable at call sites.
        // Missing files fire 'loaderror' below and then fail gracefully at
        // playback time via AudioManager's cache.audio.exists() check.
        const SFX_KEYS = [
            'gunshot_shotgun', 'gunshot_sniper', 'gunshot_mg', 'gunshot_pistol',
            'bullet_impact', 'enemy_death', 'player_hit',
            'heal_tick', 'potion_throw', 'potion_pickup',
            'boss_telegraph', 'boss_slam', 'boss_burst', 'boss_death',
            'player_death', 'wave_clear', 'victory'
        ];
        const MUSIC_KEYS = ['music_menu', 'music_game', 'music_boss'];

        // Register the error handler BEFORE queueing the loads so it catches
        // everything (Phaser fires loaderror synchronously during the load).
        this.load.on('loaderror', (file) => {
            console.warn(`[Preloader] Failed to load: ${file.key} (${file.src})`);
        });

        for (const k of SFX_KEYS)   this.load.audio(k, `audio/sfx/${k}.ogg`);
        for (const k of MUSIC_KEYS) this.load.audio(k, `audio/music/${k}.mp3`);
    }

    create ()
    {
        //  When all the assets have loaded, it's often worth creating global objects here that the rest of the game can use.
        //  For example, you can define global animations here, so we can use them in other scenes.

        //  Move to the MainMenu. You could also swap this for a Scene Transition, such as a camera fade.
        this.scene.start('MainMenu');
    }
}
