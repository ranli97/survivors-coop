import { Scene } from 'phaser';
import { AudioManager } from '../audioManager.js';

// MainMenu: title + START GAME button + audio settings panel.
//
// The "click anywhere to start" model was replaced with an explicit button
// so the volume sliders below can be clicked/dragged without accidentally
// advancing to ClassSelect. Only the START button's pointerdown triggers
// the scene change.
export class MainMenu extends Scene
{
    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        this.cameras.main.setBackgroundColor('#1a1a1a');

        const centerX = this.scale.width / 2;

        this.add.text(centerX, 120, 'SURVIVORS CO-OP', {
            fontFamily: 'Arial Black',
            fontSize: 64,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5);

        this.createStartButton(centerX, 240);
        this.createAudioPanel(centerX);

        // Attribution. Pinned to the camera with setScrollFactor(0) for
        // consistency with the rest of the HUD-ish elements on this scene
        // (MainMenu doesn't scroll, but it keeps the pattern uniform).
        this.add.text(centerX, 720, 'Music: Purple Planet (purple-planet.com)', {
            fontFamily: 'Arial',
            fontSize: 14,
            color: '#666666',
            align: 'center'
        }).setOrigin(0.5).setScrollFactor(0);

        // Kick off menu music. Phaser auto-unlocks audio on the first user
        // gesture (slider drag, button click, mute toggle -- any of them
        // satisfy the browser's AudioContext gesture requirement).
        AudioManager.playMusic(this, 'music_menu');
    }

    // Big rectangular button. Own interactive rect so drags on the volume
    // sliders below don't fire its pointerdown.
    createStartButton (cx, cy)
    {
        const W = 260;
        const H = 64;
        const FILL_IDLE  = 0x333333;
        const FILL_HOVER = 0x555555;

        const bg = this.add.rectangle(cx, cy, W, H, FILL_IDLE)
            .setStrokeStyle(2, 0xffffff)
            .setInteractive({ useHandCursor: true });

        this.add.text(cx, cy, 'START GAME', {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);

        bg.on('pointerover', () => bg.setFillStyle(FILL_HOVER));
        bg.on('pointerout',  () => bg.setFillStyle(FILL_IDLE));
        bg.on('pointerdown', () => this.scene.start('ClassSelect'));
    }

    // Stacks the audio-settings heading, three sliders, and the mute button
    // vertically. All values come from AudioManager (which has already
    // loaded them from localStorage in Boot).
    createAudioPanel (cx)
    {
        this.add.text(cx, 350, 'AUDIO SETTINGS', {
            fontFamily: 'Arial Black',
            fontSize: 18,
            color: '#888888',
            align: 'center'
        }).setOrigin(0.5);

        this.buildSlider(cx, 400, 'Master Volume',
            AudioManager.getMasterVolume(),
            (v) => AudioManager.setMasterVolume(v));

        this.buildSlider(cx, 460, 'Music Volume',
            AudioManager.getMusicVolume(),
            (v) => AudioManager.setMusicVolume(v));

        this.buildSlider(cx, 520, 'SFX Volume',
            AudioManager.getSfxVolume(),
            (v) => AudioManager.setSfxVolume(v));

        this.createMuteButton(cx, 600);
    }

    // One row = label + track + draggable handle. initialValue is 0..1.
    // onChange fires every drag tick with the new 0..1 value.
    buildSlider (cx, y, label, initialValue, onChange)
    {
        // Named-imports-only project rule forbids Phaser.Math.Clamp; inline
        // a local one so the drag handler stays self-contained.
        const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

        const TRACK_W = 200;
        const TRACK_H = 4;
        const HANDLE_R = 14;
        const trackLeft = cx - TRACK_W / 2;
        const trackRight = cx + TRACK_W / 2;

        this.add.text(cx, y - 20, label, {
            fontFamily: 'Arial',
            fontSize: 16,
            color: '#cccccc'
        }).setOrigin(0.5);

        this.add.rectangle(cx, y, TRACK_W, TRACK_H, 0x555555);

        const startX = trackLeft + TRACK_W * initialValue;
        const handle = this.add.circle(startX, y, HANDLE_R, 0xffffff)
            .setStrokeStyle(2, 0x000000)
            .setInteractive({ draggable: true, useHandCursor: true });

        // setDraggable() + 'drag' is Phaser's idiomatic drag wiring -- the
        // drag event receives the pointer's *world* x in dragX, so we clamp
        // it into [trackLeft, trackRight] before reading back the ratio.
        this.input.setDraggable(handle);
        handle.on('drag', (pointer, dragX) => {
            handle.x = clamp(dragX, trackLeft, trackRight);
            const v = (handle.x - trackLeft) / TRACK_W;
            onChange(v);
        });
    }

    createMuteButton (cx, y)
    {
        const W = 120;
        const H = 40;
        const FILL_IDLE  = 0x333333;
        const FILL_HOVER = 0x555555;

        const bg = this.add.rectangle(cx, y, W, H, FILL_IDLE)
            .setStrokeStyle(2, 0xffffff)
            .setInteractive({ useHandCursor: true });

        const label = this.add.text(cx, y, AudioManager.isMuted() ? 'UNMUTE' : 'MUTE', {
            fontFamily: 'Arial Black',
            fontSize: 18,
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);

        bg.on('pointerover', () => bg.setFillStyle(FILL_HOVER));
        bg.on('pointerout',  () => bg.setFillStyle(FILL_IDLE));
        bg.on('pointerdown', () => {
            const next = !AudioManager.isMuted();
            AudioManager.setMuted(next);
            label.setText(next ? 'UNMUTE' : 'MUTE');
            // Audible confirmation that the state changed. When muting,
            // this is suppressed by the effective-volume=0 short circuit
            // in AudioManager.playSfx, which is fine -- silence IS the
            // confirmation in that direction.
            AudioManager.playSfx(this, 'potion_pickup');
        });
    }
}
