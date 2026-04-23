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
        // Green circle with a darker-green triangle "nub" on the right side
        // (at angle 0). Phaser sprites treat rotation 0 as facing +X, so the
        // nub visually points in whatever direction the player is aiming.
        this.createPlayerTexture('player', PLAYER_RADIUS, 0x44dd44, 0x22aa22);

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

        // --- Shooting -------------------------------------------------------------
        // Group that owns all active bullets. Using a physics group means every
        // bullet spawned via this.bullets.create(...) automatically gets a
        // dynamic Arcade body -- we'll need those bodies for enemy collisions
        // later.
        this.bullets = this.physics.add.group();

        // Small yellow circle texture for bullets (same trick as the player).
        this.createCircleTexture('bullet', 4, 0xffff00);

        // Timestamp (ms, scene time) of the last bullet we fired. Used to
        // throttle auto-fire to 8 shots/sec.
        this.lastFireTime = 0;

        // Stashed so update() can check whether a bullet has left the world
        // without having to know the WORLD_WIDTH/HEIGHT constants.
        this.worldWidth = WORLD_WIDTH;
        this.worldHeight = WORLD_HEIGHT;
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

        // --- Aiming ---------------------------------------------------------------
        // We use the pointer's WORLD coords (not screen coords) so aiming stays
        // correct as the camera scrolls with the player.
        const pointer = this.input.activePointer;
        const aimDx = pointer.worldX - this.player.x;
        const aimDy = pointer.worldY - this.player.y;
        // Math.atan2 returns radians; Phaser sprite rotation 0 = facing +X,
        // which matches our "nub on the right side" texture.
        this.player.rotation = Math.atan2(aimDy, aimDx);

        // --- Shooting -------------------------------------------------------------
        // Hold left mouse to auto-fire at 8 shots/sec (1 bullet every 125 ms).
        const FIRE_INTERVAL_MS = 125;
        if (pointer.leftButtonDown() && this.time.now - this.lastFireTime >= FIRE_INTERVAL_MS)
        {
            this.fireBullet();
            this.lastFireTime = this.time.now;
        }

        // --- Bullet lifetime ------------------------------------------------------
        // Destroy bullets that have flown more than 600 px from spawn OR that
        // have left the world. Squared-distance comparison avoids a sqrt per
        // bullet per frame.
        const MAX_BULLET_DIST = 600;
        const maxDistSq = MAX_BULLET_DIST * MAX_BULLET_DIST;
        // getChildren() returns the group's internal array. We slice() it so
        // destroying bullets mid-loop can't mutate what we're iterating.
        this.bullets.getChildren().slice().forEach((bullet) => {
            if (!bullet || !bullet.active) return;

            const bdx = bullet.x - bullet.getData('spawnX');
            const bdy = bullet.y - bullet.getData('spawnY');
            const travelledSq = bdx * bdx + bdy * bdy;

            const outOfWorld =
                bullet.x < 0 || bullet.x > this.worldWidth ||
                bullet.y < 0 || bullet.y > this.worldHeight;

            if (travelledSq > maxDistSq || outOfWorld)
            {
                bullet.destroy();
            }
        });
    }

    // --- Helpers -----------------------------------------------------------------

    // Spawn a bullet at the player's position, travelling in whatever direction
    // the player is currently facing (this.player.rotation, in radians).
    fireBullet ()
    {
        const BULLET_SPEED = 600;
        const BULLET_RADIUS = 4;

        const angle = this.player.rotation;
        const spawnX = this.player.x;
        const spawnY = this.player.y;

        // physics.add.group().create() returns a sprite with a dynamic Arcade
        // body already attached -- no need to manually enable physics.
        const bullet = this.bullets.create(spawnX, spawnY, 'bullet');
        bullet.body.setCircle(BULLET_RADIUS);

        // Remember where the bullet started so update() can retire it after it
        // has travelled 600 px.
        bullet.setData('spawnX', spawnX);
        bullet.setData('spawnY', spawnY);

        // Convert the aim angle into a velocity vector.
        bullet.body.setVelocity(
            Math.cos(angle) * BULLET_SPEED,
            Math.sin(angle) * BULLET_SPEED
        );
    }

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

    // Like createCircleTexture, but also paints a darker triangle "nub" on the
    // right side of the circle (at angle 0) so rotation is visible.
    // The nub sits inside the right half of the circle, so the texture stays a
    // tidy (2*radius) x (2*radius) square. That keeps the sprite origin at the
    // circle's center and makes body.setCircle(radius) work with no offset.
    createPlayerTexture (key, radius, color, nubColor)
    {
        const g = this.add.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(color, 1);
        g.fillCircle(radius, radius, radius);

        // Triangle pointing right, fully inside the right half of the circle.
        g.fillStyle(nubColor, 1);
        g.fillTriangle(
            radius + radius * 0.25, radius - radius * 0.45,
            radius + radius * 0.25, radius + radius * 0.45,
            radius + radius * 0.90, radius
        );

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
