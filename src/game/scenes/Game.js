import { Scene } from 'phaser';
import { CLASSES, DEFAULT_CLASS_KEY } from '../classes.js';

// Gameplay scene: sets up a large world, the player, WASD movement,
// and a camera that follows the player.
export class Game extends Scene
{
    constructor ()
    {
        super('Game');
    }

    // Phaser calls init(data) before create(). ClassSelect passes the chosen
    // class via scene.start('Game', { classKey }). If we're ever started
    // without data (e.g. hot reload, dev tool), fall back to the default.
    init (data)
    {
        const key = (data && data.classKey) || DEFAULT_CLASS_KEY;
        // Unknown keys also fall back -- safer than crashing in create().
        this.classKey = CLASSES[key] ? key : DEFAULT_CLASS_KEY;
        this.classDef = CLASSES[this.classKey];
    }

    create ()
    {
        // --- Level/wave constants -------------------------------------------------
        // Levels 1..14 are the normal survival loop. Level 15 is reserved for a
        // future boss fight; when the player clears level 14 we just log a
        // placeholder for now.
        const FIRST_LEVEL = 1;
        const LAST_NORMAL_LEVEL = 14;
        const INTERMISSION_MS = 3000;

        // Exposed so onWaveCleared() can read/enforce the cap without having to
        // re-declare the constant.
        this.lastNormalLevel = LAST_NORMAL_LEVEL;
        this.intermissionMs = INTERMISSION_MS;

        this.currentLevel = FIRST_LEVEL;

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
        // Per-class texture key so each class caches its own colored sprite
        // (re-entering Game with the same class reuses the cached texture;
        // switching classes generates a fresh one). The "nub" is a darker
        // shade of the class color so rotation is visible regardless of which
        // class was picked.
        const textureKey = `player_${this.classKey}`;
        const nubColor = this.darkenColor(this.classDef.color, 0.6);
        if (!this.textures.exists(textureKey))
        {
            this.createPlayerTexture(textureKey, PLAYER_RADIUS, this.classDef.color, nubColor);
        }

        // Spawn the player in the middle of the world.
        this.player = this.physics.add.sprite(
            WORLD_WIDTH / 2,
            WORLD_HEIGHT / 2,
            textureKey
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

        // --- Player stats ---------------------------------------------------------
        // HP caps come from the selected class (brawler 120, sniper 80, etc.).
        this.playerMaxHp = this.classDef.hp;
        this.playerHp = this.classDef.hp;
        // Guard: overlap callbacks can fire multiple times on the frame HP
        // hits 0, which would queue up multiple scene transitions. This flag
        // makes sure damage + scene.start each happen at most once.
        this.playerDead = false;

        // --- HUD ------------------------------------------------------------------
        // HP text pinned to the top-left of the screen. setScrollFactor(0)
        // keeps it fixed relative to the camera, so it doesn't move with the
        // world as the player scrolls.
        this.hpText = this.add.text(16, 16, '', {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4
        }).setScrollFactor(0);
        this.updateHpText();

        // Class readout directly below the HP line. Smaller font than hpText
        // so it reads as a secondary line in the same HUD group.
        this.classText = this.add.text(16, 44, `Class: ${this.classDef.name}`, {
            fontFamily: 'Arial Black',
            fontSize: 18,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setScrollFactor(0);

        // Level readout (top-center). Same font family as hpText so the HUD
        // reads as a single visual group.
        this.levelText = this.add.text(this.scale.width / 2, 16, '', {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5, 0).setScrollFactor(0);

        // Remaining-enemies readout (top-right). Origin (1, 0) anchors its
        // right edge to (width - 16, 16) so the text grows leftward.
        this.enemiesText = this.add.text(this.scale.width - 16, 16, '', {
            fontFamily: 'Arial Black',
            fontSize: 24,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(1, 0).setScrollFactor(0);

        // --- Enemies --------------------------------------------------------------
        // Physics group that owns every enemy. Members get dynamic Arcade bodies.
        this.enemies = this.physics.add.group();

        // Red circle texture (reuses the same helper the player/bullet use).
        this.createCircleTexture('enemy', 14, 0xdd3333);

        // Kick off the first wave. The ring-spawn math that used to live here
        // has moved into startLevel() so every level can reuse it.
        this.startLevel(this.currentLevel);

        // --- Combat overlaps ------------------------------------------------------
        // overlap (not collider) so enemies don't physically push the player --
        // we just want the callback to fire when bodies touch.
        this.physics.add.overlap(this.bullets, this.enemies, this.onBulletHitEnemy, null, this);
        this.physics.add.overlap(this.player,  this.enemies, this.onEnemyTouchPlayer, null, this);
    }

    update ()
    {
        // Per-class movement speed (medic 220 > brawler/gunner 200 > sniper 180).
        const SPEED = this.classDef.speed;
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
        // Hold left mouse to auto-fire. Rate comes from the class definition
        // (sniper 1/s, brawler ~1.5/s, medic 4/s, gunner 12/s). fireWeapon()
        // itself dispatches on weapon type -- one call = "one trigger pull",
        // which for the shotgun means a full pellet spread.
        const FIRE_INTERVAL_MS = this.classDef.fireRateMs;
        if (pointer.leftButtonDown() && this.time.now - this.lastFireTime >= FIRE_INTERVAL_MS)
        {
            this.fireWeapon();
            this.lastFireTime = this.time.now;
        }

        // --- Bullet lifetime ------------------------------------------------------
        // Each bullet carries its own max-range-squared (cached on spawn so we
        // don't re-square per frame). Sniper bullets travel 1500 px, shotgun
        // pellets only 400, etc. We also retire bullets that leave the world.
        // getChildren() returns the group's internal array. We slice() it so
        // destroying bullets mid-loop can't mutate what we're iterating.
        this.bullets.getChildren().slice().forEach((bullet) => {
            if (!bullet || !bullet.active) return;

            const bdx = bullet.x - bullet.getData('spawnX');
            const bdy = bullet.y - bullet.getData('spawnY');
            const travelledSq = bdx * bdx + bdy * bdy;
            const maxDistSq = bullet.getData('rangeSq');

            const outOfWorld =
                bullet.x < 0 || bullet.x > this.worldWidth ||
                bullet.y < 0 || bullet.y > this.worldHeight;

            if (travelledSq > maxDistSq || outOfWorld)
            {
                bullet.destroy();
            }
        });

        // --- Enemies --------------------------------------------------------------
        // Chase logic is in a helper to keep update() readable.
        this.updateEnemies();
    }

    // --- Helpers -----------------------------------------------------------------

    // Spawn a single bullet from the player at the supplied angle (radians).
    // Taking an explicit angle (rather than reading this.player.rotation)
    // lets fireWeapon() call this N times with N different angles -- that's
    // what turns one trigger pull into a shotgun blast or a jittered MG shot.
    fireSingleBullet (angle)
    {
        const BULLET_RADIUS = 4;
        const speed = this.classDef.bulletSpeed;
        const range = this.classDef.bulletRange;

        const spawnX = this.player.x;
        const spawnY = this.player.y;

        // physics.add.group().create() returns a sprite with a dynamic Arcade
        // body already attached -- no need to manually enable physics.
        const bullet = this.bullets.create(spawnX, spawnY, 'bullet');
        bullet.body.setCircle(BULLET_RADIUS);

        // Per-bullet metadata. spawnX/Y lets update() compute travel distance;
        // damage is read by onBulletHitEnemy; rangeSq is pre-squared so the
        // per-frame range check can skip the sqrt.
        bullet.setData('spawnX', spawnX);
        bullet.setData('spawnY', spawnY);
        bullet.setData('damage', this.classDef.bulletDamage);
        bullet.setData('range', range);
        bullet.setData('rangeSq', range * range);

        // Convert the aim angle into a velocity vector.
        bullet.body.setVelocity(
            Math.cos(angle) * speed,
            Math.sin(angle) * speed
        );
    }

    // One "trigger pull". Dispatches to the right firing pattern for the
    // selected class's weapon. Called from update() on each fire-rate tick.
    fireWeapon ()
    {
        const rotation = this.player.rotation;
        const weapon = this.classDef.weapon;

        if (weapon === 'pistol' || weapon === 'sniper')
        {
            // Dead straight single shot -- the bullet stats (damage, speed,
            // range) are what differentiate pistol from sniper.
            this.fireSingleBullet(rotation);
            return;
        }

        if (weapon === 'mg')
        {
            // Small random angle deviation on every shot so sustained fire
            // forms a slight cone instead of a perfect line.
            const jitterRad = (this.classDef.jitterDegrees * Math.PI) / 180;
            const offset = (Math.random() - 0.5) * 2 * jitterRad;
            this.fireSingleBullet(rotation + offset);
            return;
        }

        if (weapon === 'shotgun')
        {
            // Uniformly sample each pellet's angle from the full cone
            // [rotation - half, rotation + half]. Cheap and gives a natural
            // "spray" distribution.
            const halfConeRad = ((this.classDef.spreadDegrees / 2) * Math.PI) / 180;
            const pellets = this.classDef.pellets;
            for (let i = 0; i < pellets; i++)
            {
                const offset = (Math.random() - 0.5) * 2 * halfConeRad;
                this.fireSingleBullet(rotation + offset);
            }
            return;
        }
    }

    // Create one enemy at (x, y), add it to the enemies group, give it a
    // circular hit area that matches the visual, and keep it inside the world.
    spawnEnemy (x, y)
    {
        const ENEMY_RADIUS = 14;
        const enemy = this.enemies.create(x, y, 'enemy');
        enemy.body.setCircle(ENEMY_RADIUS);
        enemy.setCollideWorldBounds(true);
        // Per-enemy combat state. Stored via setData so it travels with the
        // sprite and is trivial to customize per-enemy later (e.g. tougher
        // variants just pass a higher starting hp).
        enemy.setData('hp', 1);
        enemy.setData('lastHitTime', 0);
        // HUD readout of remaining enemies has to tick on spawn as well as on
        // kill, otherwise the top-right count lags by one at wave start.
        this.updateEnemiesText();
        return enemy;
    }

    // Each frame, steer every enemy straight toward the player at a fixed speed.
    updateEnemies ()
    {
        const ENEMY_SPEED = 100;

        // getChildren() returns a plain array; slice() mirrors the bullet
        // cleanup pattern and guards against any mid-loop mutation.
        this.enemies.getChildren().slice().forEach((enemy) => {
            if (!enemy || !enemy.active) return;

            // Direction vector from enemy toward the player.
            let dx = this.player.x - enemy.x;
            let dy = this.player.y - enemy.y;

            // Normalize so enemies travel at a constant speed regardless of
            // distance. Skip the rare zero-length case to avoid divide-by-zero.
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length === 0)
            {
                enemy.body.setVelocity(0, 0);
                return;
            }
            dx /= length;
            dy /= length;

            enemy.body.setVelocity(dx * ENEMY_SPEED, dy * ENEMY_SPEED);
        });
    }

    // Bullet overlapping an enemy: consume the bullet, take 1 hp off the
    // enemy, and destroy it if hp has reached zero.
    onBulletHitEnemy (bullet, enemy)
    {
        if (!bullet.active || !enemy.active) return;

        bullet.destroy();

        // Each bullet carries its own damage value (shotgun pellet 15, sniper
        // round 100, etc.). Enemies currently spawn with hp 1 so any hit still
        // kills, but wiring damage through correctly means tougher enemy
        // variants in a later step will "just work".
        const damage = bullet.getData('damage') || 1;
        const newHp = enemy.getData('hp') - damage;
        enemy.setData('hp', newHp);
        if (newHp <= 0)
        {
            enemy.destroy();
            // Refresh the remaining-enemies HUD immediately, then check
            // whether this kill was the last one in the wave. countActive(true)
            // only counts living group members, so the destroyed enemy above is
            // already excluded.
            this.updateEnemiesText();
            if (this.enemies.countActive(true) === 0)
            {
                this.onWaveCleared();
            }
        }
    }

    // Enemy overlapping the player: apply a 10 hp hit, but only if this
    // specific enemy hasn't hit in the last 1000 ms. Overlap callbacks fire
    // every frame bodies are in contact, so the cooldown is what turns
    // "continuous contact" into discrete damage ticks.
    onEnemyTouchPlayer (player, enemy)
    {
        if (this.playerDead) return;
        if (!enemy.active) return;

        const DAMAGE_COOLDOWN_MS = 1000;
        const now = this.time.now;
        if (now - enemy.getData('lastHitTime') < DAMAGE_COOLDOWN_MS) return;
        enemy.setData('lastHitTime', now);

        this.playerHp -= 10;
        this.updateHpText();
        this.flashPlayerHit();

        if (this.playerHp <= 0)
        {
            // Latch so any further overlap callbacks on this frame are no-ops.
            this.playerDead = true;
            this.scene.start('GameOver');
        }
    }

    // Brief red tint on the player so damage is visible on the HUD *and* the
    // player sprite itself.
    flashPlayerHit ()
    {
        this.player.setTint(0xff4444);
        this.time.delayedCall(100, () => {
            // The scene may have already transitioned to GameOver by the time
            // this fires, in which case this.player has been torn down.
            if (this.player && this.player.active)
            {
                this.player.clearTint();
            }
        });
    }

    // Refresh the HP readout in the HUD. Call whenever this.playerHp changes.
    updateHpText ()
    {
        this.hpText.setText(`HP: ${this.playerHp}`);
    }

    // Refresh the top-center level readout.
    updateLevelText ()
    {
        this.levelText.setText(`Level ${this.currentLevel}`);
    }

    // Refresh the top-right remaining-enemies readout. countActive(true) only
    // counts living group members, which is exactly what we want.
    updateEnemiesText ()
    {
        this.enemiesText.setText(`Enemies: ${this.enemies.countActive(true)}`);
    }

    // Kick off a wave: update HUD, flash a "Level N" banner, then spawn
    // 5 + (level - 1) * 2 enemies in the same 300-600 px ring around the
    // player that create() originally used for its 5-enemy starter group.
    startLevel (level)
    {
        this.updateLevelText();
        this.showBanner(`Level ${level}`, '', 1500);

        const enemyCount = 5 + (level - 1) * 2;
        const MIN_SPAWN_DIST = 300;
        const MAX_SPAWN_DIST = 600;
        for (let i = 0; i < enemyCount; i++)
        {
            const angle = Math.random() * Math.PI * 2;
            const dist = MIN_SPAWN_DIST + Math.random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST);
            const x = this.player.x + Math.cos(angle) * dist;
            const y = this.player.y + Math.sin(angle) * dist;
            this.spawnEnemy(x, y);
        }

        // spawnEnemy already updates the HUD per enemy, but call once more so
        // the count is authoritative in the (future) edge case where a wave
        // starts with zero enemies.
        this.updateEnemiesText();
    }

    // Called the moment the last enemy in the current wave is destroyed.
    // Advances to the next level after a short intermission, or logs a
    // placeholder if we've just cleared the last normal level (boss slot).
    onWaveCleared ()
    {
        if (this.currentLevel >= this.lastNormalLevel)
        {
            // Level 15 is the reserved boss slot -- not implemented yet.
            console.log('Boss level would start here');
            return;
        }

        const cleared = this.currentLevel;
        this.currentLevel = cleared + 1;

        this.showBanner(
            `Level ${cleared} Cleared!`,
            'Next wave in 3...',
            this.intermissionMs
        );

        // playerDead guard: if the player dies during the intermission, the
        // scene has already transitioned to GameOver. Starting a new wave
        // here would spawn enemies into a scene that's tearing down.
        this.time.delayedCall(this.intermissionMs, () => {
            if (this.playerDead) return;
            this.startLevel(this.currentLevel);
        });
    }

    // Fullscreen-centered two-line banner. Both lines are pinned to the camera
    // (setScrollFactor(0)) so they don't drift with the world, and both are
    // destroyed together after durationMs. Passing an empty bottomLine shows
    // only the top line (used for the "Level N" splash).
    showBanner (topLine, bottomLine, durationMs)
    {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        const top = this.add.text(cx, cy, topLine, {
            fontFamily: 'Arial Black',
            fontSize: 56,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center'
        }).setOrigin(0.5, 1).setScrollFactor(0);

        // Bottom line is optional -- skip the allocation entirely for the
        // "Level N" splash which only needs a single line.
        let bottom = null;
        if (bottomLine && bottomLine.length > 0)
        {
            bottom = this.add.text(cx, cy + 8, bottomLine, {
                fontFamily: 'Arial Black',
                fontSize: 28,
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center'
            }).setOrigin(0.5, 0).setScrollFactor(0);
        }

        this.time.delayedCall(durationMs, () => {
            if (top && top.active) top.destroy();
            if (bottom && bottom.active) bottom.destroy();
        });
    }

    // Multiply each RGB channel of a 0xRRGGBB int by `factor` (0..1) and
    // recompose. Used to derive the player's "nub" color from whatever color
    // the selected class picked, so every class gets a visibly darker nub
    // without hardcoding a second color per class.
    darkenColor (color, factor)
    {
        const r = Math.max(0, Math.min(255, Math.floor(((color >> 16) & 0xff) * factor)));
        const g = Math.max(0, Math.min(255, Math.floor(((color >> 8) & 0xff) * factor)));
        const b = Math.max(0, Math.min(255, Math.floor((color & 0xff) * factor)));
        return (r << 16) | (g << 8) | b;
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
