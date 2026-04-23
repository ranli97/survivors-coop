import { Scene } from 'phaser';

// Gameplay scene: sets up a large world, the player, WASD movement,
// and a camera that follows the player.
export class Game extends Scene
{
    constructor ()
    {
        super('Game');
    }

    create ()
    {
        // --- World + camera setup -------------------------------------------------
        const WORLD_WIDTH = 2000;
        const WORLD_HEIGHT = 2000;

        // Dark background so the green player stands out.
        this.cameras.main.setBackgroundColor('#1a1a1a');

        // Arcade physics world bounds (so bodies can collide with the edges).
        this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

        // Camera can scroll across the entire world.
        this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

        // --- Background grid ------------------------------------------------------
        // A semi-transparent grid gives a visual reference so you can tell the
        // player is actually moving through the world.
        this.drawGrid(WORLD_WIDTH, WORLD_HEIGHT, 100, 0xffffff, 0.08);

        // --- Player ---------------------------------------------------------------
        // Build a small circle texture once, then use it as a sprite. Using a
        // sprite (rather than a raw Graphics object) keeps Arcade Physics simple.
        const PLAYER_RADIUS = 16;
        this.createCircleTexture('player', PLAYER_RADIUS, 0x44dd44);

        // Spawn the player in the middle of the world.
        this.player = this.physics.add.sprite(
            WORLD_WIDTH / 2,
            WORLD_HEIGHT / 2,
            'player'
        );

        // Keep the player inside the world bounds.
        this.player.setCollideWorldBounds(true);

        // A circular hit area matches the visual (default is a rectangle).
        this.player.body.setCircle(PLAYER_RADIUS);

        // --- Input ---------------------------------------------------------------
        // WASD keys via Phaser's string-based registration (no KeyCodes needed).
        // Access with this.keys.W.isDown, this.keys.A.isDown, etc.
        this.keys = this.input.keyboard.addKeys('W,A,S,D');

        // --- Camera follow --------------------------------------------------------
        // The 0.1 lerp values make the camera ease toward the player rather than
        // snapping, which feels smoother.
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    }

    update ()
    {
        const SPEED = 200;
        const body = this.player.body;

        // Read WASD into a simple direction vector.
        let dx = 0;
        let dy = 0;

        if (this.keys.A.isDown) dx -= 1;
        if (this.keys.D.isDown) dx += 1;
        if (this.keys.W.isDown) dy -= 1;
        if (this.keys.S.isDown) dy += 1;

        // Normalize so diagonal movement isn't faster than straight movement.
        // (A raw (1, 1) vector has length ~1.41, which would be too fast.)
        if (dx !== 0 || dy !== 0)
        {
            const length = Math.sqrt(dx * dx + dy * dy);
            dx /= length;
            dy /= length;
        }

        body.setVelocity(dx * SPEED, dy * SPEED);
    }

    // --- Helpers -----------------------------------------------------------------

    // Generate a solid-color circle texture we can use as a sprite.
    // This avoids needing any image assets on disk.
    createCircleTexture (key, radius, color)
    {
        const g = this.add.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(color, 1);
        g.fillCircle(radius, radius, radius);
        g.generateTexture(key, radius * 2, radius * 2);
        g.destroy();
    }

    // Draw a faint grid across the whole world as a movement reference.
    drawGrid (width, height, cellSize, color, alpha)
    {
        const grid = this.add.graphics();
        grid.lineStyle(1, color, alpha);

        for (let x = 0; x <= width; x += cellSize)
        {
            grid.lineBetween(x, 0, x, height);
        }
        for (let y = 0; y <= height; y += cellSize)
        {
            grid.lineBetween(0, y, width, y);
        }
    }
}
