import { Scene } from 'phaser';
import { CLASSES, DEFAULT_CLASS_KEY } from '../classes.js';
import { AudioManager } from '../audioManager.js';

// Shown once the player defeats the level 15 boss. Pure UI scene -- no
// physics, no input beyond "click to return". Class key is passed in from
// Game.js so the stats block can colour "Class: <Name>" to match what the
// player actually played.
export class Victory extends Scene
{
    constructor ()
    {
        super('Victory');
    }

    // init() runs before create(), same pattern as Game.js. Defensive
    // fallback to DEFAULT_CLASS_KEY keeps the scene from crashing if it's
    // ever started without data (dev-tools reruns, hot reload, etc.).
    init (data)
    {
        this.classKey = (data && data.classKey) || DEFAULT_CLASS_KEY;
        this.classDef = CLASSES[this.classKey] || CLASSES[DEFAULT_CLASS_KEY];
    }

    create ()
    {
        const cx = this.scale.width / 2;

        this.cameras.main.setBackgroundColor('#1a1a1a');

        // Subtle purple glow -- thematic callback to the boss's color.
        // alpha=0.08 keeps it from competing with the text for attention.
        const glow = this.add.graphics();
        glow.fillStyle(0x9933ff, 0.08);
        glow.fillCircle(cx, this.scale.height / 2, 400);

        // Title. Gold contrasts with the purple glow and reads as
        // celebratory without hardcoding any class-specific colour.
        this.add.text(cx, 180, 'VICTORY!', {
            fontFamily: 'Arial Black',
            fontSize: 72,
            color: '#ffd633',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);

        this.add.text(cx, 260, 'You have defeated the Purple Menace', {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);

        // Convert the class colour (0xRRGGBB int) into a "#rrggbb" string
        // that Phaser's text config accepts. padStart guarantees six hex
        // digits even for colours where the leading byte is 0x00.
        const classHex = '#' + this.classDef.color.toString(16).padStart(6, '0');
        this.add.text(cx, 380, `Class: ${this.classDef.name}`, {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: classHex,
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);
        this.add.text(cx, 412, 'Final Level: 15', {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);

        this.add.text(cx, 560, 'Click to return to menu', {
            fontFamily: 'Arial Black',
            fontSize: 22,
            color: '#cccccc',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);

        // Victory sting + return to menu theme. playMusic crossfades from
        // whatever was still playing (music_boss) into music_menu.
        AudioManager.playSfx(this, 'victory');
        AudioManager.playMusic(this, 'music_menu');

        // once() (not on()) so we don't double-fire if the user mashes
        // during the scene transition.
        this.input.once('pointerdown', () => this.scene.start('MainMenu'));
    }
}
