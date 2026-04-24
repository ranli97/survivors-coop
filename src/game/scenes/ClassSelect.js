import { Scene } from 'phaser';
import { CLASSES } from '../classes.js';

// ClassSelect: 4 horizontally-arranged cards, one per playable class. Clicking
// a card (or pressing 1-4) starts the Game scene with the chosen class.
//
// The card order is driven by CLASS_ORDER, NOT Object.keys(CLASSES), so the
// 1..4 keyboard mapping is stable even if classes.js reorders entries later.
export class ClassSelect extends Scene
{
    constructor ()
    {
        super('ClassSelect');
    }

    create ()
    {
        const CLASS_ORDER = ['brawler', 'sniper', 'gunner', 'medic'];

        // Match MainMenu's background so the transition doesn't flash.
        this.cameras.main.setBackgroundColor('#1a1a1a');

        const width = this.scale.width;
        const height = this.scale.height;
        const centerX = width / 2;

        // Title near the top.
        this.add.text(centerX, 80, 'SELECT YOUR CLASS', {
            fontFamily: 'Arial Black',
            fontSize: 48,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center'
        }).setOrigin(0.5);

        // Subtitle prompt.
        this.add.text(centerX, 140, 'Click a card or press 1-4', {
            fontFamily: 'Arial',
            fontSize: 20,
            color: '#aaaaaa',
            align: 'center'
        }).setOrigin(0.5);

        // Horizontal card layout.
        // width 1024, 4 cards of 200px wide, 5 equal gaps = (1024 - 800) / 5 = 44.8
        const CARD_WIDTH = 200;
        const CARD_HEIGHT = 320;
        const gap = (width - CLASS_ORDER.length * CARD_WIDTH) / (CLASS_ORDER.length + 1);
        const cy = height / 2 + 20; // nudge down slightly so title has room.

        CLASS_ORDER.forEach((key, i) => {
            const classDef = CLASSES[key];
            const cx = gap + CARD_WIDTH / 2 + i * (CARD_WIDTH + gap);

            this.createCard(cx, cy, CARD_WIDTH, CARD_HEIGHT, classDef, i + 1);
        });

        // Keyboard shortcuts: 1..4 map to CLASS_ORDER[0..3].
        // Phaser's named key events use the English word for digit keys, so
        // 'keydown-ONE' fires for the "1" key.
        const digitEvents = ['keydown-ONE', 'keydown-TWO', 'keydown-THREE', 'keydown-FOUR'];
        digitEvents.forEach((eventName, i) => {
            this.input.keyboard.on(eventName, () => this.selectClass(CLASS_ORDER[i]));
        });
    }

    // Build one card. The background rect owns the hit area; everything else
    // is a passive decoration layered on top. On hover we tint the rect and
    // swap the border to white so the hovered card is unambiguous.
    createCard (cx, cy, w, h, classDef, hotkey)
    {
        const BG_IDLE = 0x222222;
        const BG_HOVER = 0x333333;
        const BORDER_IDLE = 0x555555;
        const BORDER_HOVER = 0xffffff;

        const rect = this.add.rectangle(cx, cy, w, h, BG_IDLE)
            .setStrokeStyle(2, BORDER_IDLE)
            .setInteractive({ useHandCursor: true });

        // Class color circle -- same color the in-game player sprite will use.
        this.add.circle(cx, cy - 110, 28, classDef.color);

        // Small "1" / "2" / "3" / "4" badge in the upper-left corner so
        // the keyboard shortcut is discoverable at a glance.
        this.add.text(cx - w / 2 + 12, cy - h / 2 + 8, String(hotkey), {
            fontFamily: 'Arial Black',
            fontSize: 18,
            color: '#888888'
        }).setOrigin(0, 0);

        // Class name.
        this.add.text(cx, cy - 60, classDef.name, {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);

        // Stats block (weapon / HP / speed), centered under the name.
        this.add.text(
            cx,
            cy - 20,
            `${classDef.weapon.toUpperCase()}\nHP: ${classDef.hp}\nSpeed: ${classDef.speed}`,
            {
                fontFamily: 'Arial',
                fontSize: 16,
                color: '#cccccc',
                align: 'center',
                lineSpacing: 4
            }
        ).setOrigin(0.5);

        // Description, wrapped to card width minus padding.
        this.add.text(cx, cy + 70, classDef.description, {
            fontFamily: 'Arial',
            fontSize: 14,
            color: '#aaaaaa',
            align: 'center',
            wordWrap: { width: w - 20, useAdvancedWrap: true }
        }).setOrigin(0.5);

        // Hover + click wiring.
        rect.on('pointerover', () => {
            rect.setFillStyle(BG_HOVER);
            rect.setStrokeStyle(2, BORDER_HOVER);
        });
        rect.on('pointerout', () => {
            rect.setFillStyle(BG_IDLE);
            rect.setStrokeStyle(2, BORDER_IDLE);
        });
        rect.on('pointerdown', () => this.selectClass(classDef.key));
    }

    // Single entry point for card clicks + keyboard shortcuts. Starting the
    // Game scene with a data payload lets Game.init(data) pick up the class.
    selectClass (key)
    {
        this.scene.start('Game', { classKey: key });
    }
}
