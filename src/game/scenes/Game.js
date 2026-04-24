import { Scene } from 'phaser';
import { CLASSES, DEFAULT_CLASS_KEY } from '../classes.js';
import {
    POTIONS, POTION_ORDER,
    POTION_COOLDOWN_MS, POTION_BUFF_DURATION_MS, POTION_GROUND_LIFETIME_MS,
    POTION_THROW_SPEED, POTION_MAX_RANGE,
    POTION_PICKUP_RADIUS, POTION_PROJECTILE_RADIUS, POTION_GROUND_RADIUS
} from '../potions.js';
import { AudioManager } from '../audioManager.js';
import { ENEMIES, DEFAULT_ENEMY_KEY } from '../enemies.js';

// Healing cadence for the medic's aura. 10 ticks/sec keeps the HUD "HP tick
// up" feel smooth while keeping per-tick amounts integer for typical
// healPerSecond values (e.g. 10 -> 1 HP per tick).
const HEAL_TICK_MS = 100;

// Level 15 boss tunables. One config object keeps every magic number next to
// its siblings -- tuning the fight is a single-file edit with no grepping.
// color_nub is baked in rather than derived via darkenColor() so the boss
// texture setup stays a single call.
const BOSS = {
    hp: 2000,
    radius: 60,
    color: 0x9933ff,
    color_nub: 0x5511aa,
    chaseSpeed: 80,
    // Slam cadence: telegraph -> dash -> idle cooldown all measured from the
    // end of the previous slam, so the player always gets at least
    // slamIntervalMs of recovery between attacks.
    slamIntervalMs: 4000,
    slamTelegraphMs: 1000,
    slamDashSpeed: 500,
    slamDashDurationMs: 500,
    slamDamage: 40,
    slamContactCooldownMs: 1000,
    burstIntervalMs: 6000,
    burstBulletCount: 8,
    burstBulletSpeed: 250,
    burstBulletDamage: 10,
    burstBulletRange: 1500,
    burstBulletRadius: 6,
    minionSpawnIntervalMs: 10000,
    minionsPerSpawn: 3,
    minionCap: 10
};

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

        // --- Healing aura (medic only) -------------------------------------------
        // isHealing/lastHealTickTime are tracked for every class so update()
        // can gate firing on them uniformly. The aura graphic and any real
        // healing effect are gated behind classDef.canHeal -- non-medic
        // classes end up with this.healAura = null and never touch it.
        this.isHealing = false;
        this.lastHealTickTime = 0;

        if (this.classDef.canHeal === true)
        {
            const r = this.classDef.healRadius;
            this.healAura = this.add.graphics();
            // Semi-transparent green fill + brighter edge stroke so the
            // radius is visible even when the fill blends with the floor.
            this.healAura.fillStyle(0x44ff44, 0.15);
            this.healAura.fillCircle(0, 0, r);
            this.healAura.lineStyle(2, 0x44ff44, 0.6);
            this.healAura.strokeCircle(0, 0, r);
            this.healAura.setVisible(false);
        }
        else
        {
            this.healAura = null;
        }

        // --- Input ---------------------------------------------------------------
        // WASD keys via Phaser's string-based registration (no KeyCodes needed).
        // Access with this.keys.W.isDown, this.keys.A.isDown, etc.
        this.keys = this.input.keyboard.addKeys('W,A,S,D');

        // Without this, right-clicking inside the canvas pops the browser's
        // context menu, which both breaks flow and swallows the RMB event we
        // need for the medic's heal.
        this.input.mouse.disableContextMenu();

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

        // --- Potions --------------------------------------------------------------
        // Two groups: airborne projectiles (while flying from the medic toward
        // the cursor) and landed ground pickups (what any friendly entity can
        // walk over to receive the buff). Both are physics groups so bodies
        // come enabled automatically via group.create().
        this.potionProjectiles = this.physics.add.group();
        this.potionGroundItems = this.physics.add.group();

        // One texture per potion type. Sized to POTION_GROUND_RADIUS (the big
        // version); mid-flight projectiles just render at a smaller scale.
        for (const pKey of POTION_ORDER)
        {
            this.createCircleTexture(`potion_${pKey}`, POTION_GROUND_RADIUS, POTIONS[pKey].color);
        }

        // ms-since-scene-start when each ability comes off cooldown. 0 = ready.
        this.potionCooldowns = { damage: 0, speed: 0, fireRate: 0 };
        // ms-since-scene-start when each buff expires. 0 (or past) = inactive.
        this.activeBuffs = { damage: 0, speed: 0, fireRate: 0 };

        // Hotkeys + manual edge-trigger bookkeeping. We don't use JustDown
        // because that's a Phaser.* global; tracking the previous state
        // ourselves is equivalent and keeps the import list clean.
        this.potionKeys = this.input.keyboard.addKeys('ONE,TWO,THREE');
        this.potionKeyWasDown = { ONE: false, TWO: false, THREE: false };

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

        // Flipped by startBossLevel() when level 14 is cleared and flipped
        // off by onBossDefeated(). While true, the minion-spawn branch of
        // onWaveCleared() is suppressed and update() runs the boss pipeline.
        this.bossActive = false;

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

        // Healing indicator -- only ever populated by updateHealing() for the
        // medic. For other classes it lives here silently (always empty) so
        // the HUD layout stays consistent and updateHealing can write into
        // it without a null guard.
        this.healingText = this.add.text(16, 68, '', {
            fontFamily: 'Arial Black',
            fontSize: 18,
            color: '#44ff44',
            stroke: '#000000',
            strokeThickness: 3
        }).setScrollFactor(0);

        // Potion HUD (medic only). Bottom-left cluster of 3 slots, one per
        // potion in POTION_ORDER. updatePotionHud() fills in cooldown dimming
        // and active-buff outlines each frame. Non-medic classes get a null
        // handle, and update() skips updatePotionHud() for them.
        this.potionHud = null;
        if (this.classDef.canThrowPotions === true)
        {
            this.potionHud = {};
            const slotW = 48;
            const slotH = 48;
            const gap = 16;
            const baseX = 16;
            const y = this.scale.height - 60;

            POTION_ORDER.forEach((potionKey, i) => {
                const potionDef = POTIONS[potionKey];
                const cx = baseX + slotW / 2 + i * (slotW + gap);

                const rect = this.add.rectangle(cx, y, slotW, slotH, potionDef.color, 0.9)
                    .setScrollFactor(0);
                const keyLabel = this.add.text(cx, y - slotH / 2 - 2, String(i + 1), {
                    fontFamily: 'Arial Black', fontSize: 14,
                    color: '#ffffff', stroke: '#000000', strokeThickness: 3
                }).setOrigin(0.5, 1).setScrollFactor(0);
                const nameLabel = this.add.text(cx, y + slotH / 2 + 2, potionDef.name, {
                    fontFamily: 'Arial Black', fontSize: 14,
                    color: '#ffffff', stroke: '#000000', strokeThickness: 3
                }).setOrigin(0.5, 0).setScrollFactor(0);
                const cdText = this.add.text(cx, y, '', {
                    fontFamily: 'Arial Black', fontSize: 20,
                    color: '#ffffff', stroke: '#000000', strokeThickness: 4
                }).setOrigin(0.5).setScrollFactor(0);

                this.potionHud[potionKey] = { rect, keyLabel, nameLabel, cdText };
            });
        }

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

        // One texture per enemy type. Key shape is 'enemy_<enemyKey>' so it
        // won't collide with the legacy 'enemy' cache key and so spawnEnemy
        // can resolve the texture name from the enemyKey alone.
        for (const enemyKey of Object.keys(ENEMIES))
        {
            const def = ENEMIES[enemyKey];
            this.createCircleTexture(`enemy_${enemyKey}`, def.radius, def.color);
        }

        // Kick off the first wave. The ring-spawn math that used to live here
        // has moved into startLevel() so every level can reuse it.
        this.startLevel(this.currentLevel);

        // --- Combat overlaps ------------------------------------------------------
        // overlap (not collider) so enemies don't physically push the player --
        // we just want the callback to fire when bodies touch.
        this.physics.add.overlap(this.bullets, this.enemies, this.onBulletHitEnemy, null, this);
        this.physics.add.overlap(this.player,  this.enemies, this.onEnemyTouchPlayer, null, this);
        // Pickup overlap is registered for every class (not just medic) so
        // that when allies exist later, they pick up potions through the same
        // code path. Non-medics can't spawn potions so this is benign today.
        this.physics.add.overlap(this.player, this.potionGroundItems, this.onPickupPotion, null, this);

        // Start game music. Crossfades automatically from the menu track
        // that's still running from the MainMenu/ClassSelect scenes.
        AudioManager.playMusic(this, 'music_game');
    }

    update ()
    {
        // Healing first, so the "are we healing?" flag is authoritative
        // before any movement/fire logic reads it. WASD/aim still run
        // regardless of healing state below; only firing is gated.
        this.updateHealing();

        // Potion pipeline: input -> projectiles in flight -> ground pickups
        // -> HUD readout. Order matters: input can spawn a projectile this
        // frame, but projectile stepping runs next frame (velocity was just
        // set), and HUD always reflects the latest cooldown/buff state.
        this.updatePotionInput();
        this.updatePotionProjectiles();
        this.updatePotionGroundItems();
        if (this.potionHud) this.updatePotionHud();

        // Per-class movement speed (medic 220 > brawler/gunner 200 > sniper 180).
        const SPEED = this.classDef.speed * this.getBuffMultiplier('speed');
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
        // Fire-rate buff is an interval scalar (<1 = faster), so multiplying
        // does the right thing without special-casing the direction.
        const FIRE_INTERVAL_MS = this.classDef.fireRateMs * this.getBuffMultiplier('fireRate');
        // Holding RMB to heal suppresses firing -- medic can't do both at
        // once. For non-medic classes isHealing is always false, so this
        // extra check is a no-op for them.
        if (!this.isHealing &&
            pointer.leftButtonDown() &&
            this.time.now - this.lastFireTime >= FIRE_INTERVAL_MS)
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

        // --- Boss -----------------------------------------------------------------
        // Only runs during level 15. All three calls inspect live boss state
        // so the `.active` guard prevents ticking the state machine on the
        // frame after a kill (between onBossDefeated() destroying the sprite
        // and this.bossActive being flipped off).
        if (this.bossActive && this.boss && this.boss.active)
        {
            this.updateBoss();
            this.updateBossBullets();
            this.updateBossBar();
        }
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
        // Damage is baked in at fire-time; bullets already mid-flight don't
        // retroactively gain damage when the buff starts or lose it when it
        // ends. Matches the spec and keeps per-bullet bookkeeping simple.
        bullet.setData('damage', this.classDef.bulletDamage * this.getBuffMultiplier('damage'));
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

        // One gunshot sound per trigger pull, NOT per bullet. Critical for
        // the shotgun (6 pellets) so we don't stack 6 overlapping samples.
        AudioManager.playSfx(this, `gunshot_${weapon}`);

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

    // Medic-only aura update. For any class without canHeal this is a no-op
    // that just pins isHealing=false and hides the aura if one somehow
    // exists. Called at the top of update() so the flag is authoritative by
    // the time the fire gate reads it.
    updateHealing ()
    {
        if (this.classDef.canHeal !== true)
        {
            this.isHealing = false;
            if (this.healAura) this.healAura.setVisible(false);
            return;
        }

        const rmb = this.input.activePointer.rightButtonDown();
        this.isHealing = rmb;

        if (rmb)
        {
            // Follow the player each frame so the aura stays centered while
            // moving with WASD (aura graphic was drawn at local (0, 0)).
            this.healAura.setPosition(this.player.x, this.player.y).setVisible(true);
            this.healingText.setText('HEALING');

            if (this.time.now - this.lastHealTickTime >= HEAL_TICK_MS)
            {
                this.applyHealTick();
                this.lastHealTickTime = this.time.now;
            }
        }
        else
        {
            this.healAura.setVisible(false);
            this.healingText.setText('');
        }
    }

    // Apply one tick's worth of healing to every friendly target inside the
    // aura. Targets are collected into a local array so that adding
    // `this.allies` later is a one-line change -- the distance + heal logic
    // works identically for medic and allies (medic is trivially in range
    // since they're at the aura's center).
    applyHealTick ()
    {
        // Low volume because this fires every 100ms while right-click is
        // held; at full volume it becomes an irritating buzz.
        AudioManager.playSfx(this, 'heal_tick', { volume: 0.3 });

        const healPerTick = this.classDef.healPerSecond / 10;
        const radius = this.classDef.healRadius;
        const radiusSq = radius * radius;

        const targets = [];
        targets.push(this.player);
        // Future multiplayer:
        //   if (this.allies) this.allies.getChildren().forEach((a) => targets.push(a));

        for (const target of targets)
        {
            const dx = target.x - this.player.x;
            const dy = target.y - this.player.y;
            if (dx * dx + dy * dy > radiusSq) continue;

            if (target === this.player)
            {
                // Clamp to max HP, then round so the HUD never shows e.g.
                // "HP: 99.9". For spec values (+1/tick) this is a no-op.
                const healed = Math.min(this.playerMaxHp, this.playerHp + healPerTick);
                this.playerHp = Math.round(healed);
                this.updateHpText();
            }
            // Future ally branch: read maxHp off setData and clamp identically.
        }
    }

    // Manual edge-trigger for 1/2/3. We can't use Phaser.Input.Keyboard.JustDown
    // because that's a Phaser.* global; the import rules forbid those here.
    // Instead we stash last frame's isDown per key and act on the down-transition.
    updatePotionInput ()
    {
        if (this.classDef.canThrowPotions !== true) return;

        const keyNames = ['ONE', 'TWO', 'THREE'];
        for (let i = 0; i < keyNames.length; i++)
        {
            const name = keyNames[i];
            const isDown = this.potionKeys[name].isDown;
            // Only fire on the transition from up->down. Holding the key
            // must not rethrow every frame.
            if (isDown && !this.potionKeyWasDown[name])
            {
                this.tryThrowPotion(POTION_ORDER[i]);
            }
            this.potionKeyWasDown[name] = isDown;
        }
    }

    // Throw attempt for a single potion slot. Bails silently if the ability
    // is on cooldown so the input layer can fire this blindly.
    tryThrowPotion (potionKey)
    {
        if (this.time.now < this.potionCooldowns[potionKey]) return;

        // Aim from player -> cursor (world coords). We clamp the target to
        // POTION_MAX_RANGE so a click at the far edge of the screen doesn't
        // send the potion flying across the map.
        const pointer = this.input.activePointer;
        let tx = pointer.worldX;
        let ty = pointer.worldY;
        const dx = tx - this.player.x;
        const dy = ty - this.player.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > POTION_MAX_RANGE * POTION_MAX_RANGE)
        {
            const dist = Math.sqrt(distSq);
            const scale = POTION_MAX_RANGE / dist;
            tx = this.player.x + dx * scale;
            ty = this.player.y + dy * scale;
        }

        const angle = Math.atan2(ty - this.player.y, tx - this.player.x);

        // Spawn the projectile. We reuse the ground-sized texture and scale
        // it down mid-flight -- cheaper than maintaining two textures per
        // potion and visually implies "it grows when it hits the ground".
        const proj = this.potionProjectiles.create(this.player.x, this.player.y, `potion_${potionKey}`);
        proj.setScale(POTION_PROJECTILE_RADIUS / POTION_GROUND_RADIUS);
        // Center the circular body on the scaled sprite. The texture is
        // POTION_GROUND_RADIUS*2 px wide, so the offset to center a
        // POTION_PROJECTILE_RADIUS body is (ground - projectile) on each axis.
        proj.body.setCircle(
            POTION_PROJECTILE_RADIUS,
            POTION_GROUND_RADIUS - POTION_PROJECTILE_RADIUS,
            POTION_GROUND_RADIUS - POTION_PROJECTILE_RADIUS
        );
        proj.setData('potionKey', potionKey);
        proj.setData('targetX', tx);
        proj.setData('targetY', ty);
        proj.setData('spawnX', this.player.x);
        proj.setData('spawnY', this.player.y);
        proj.body.setVelocity(Math.cos(angle) * POTION_THROW_SPEED, Math.sin(angle) * POTION_THROW_SPEED);

        this.potionCooldowns[potionKey] = this.time.now + POTION_COOLDOWN_MS;

        // Success-path only: placed after the cooldown check at the top of
        // the method returns, so a key spam on cooldown stays silent.
        AudioManager.playSfx(this, 'potion_throw');
    }

    // Step each in-flight potion. When it reaches its stored target (within
    // 8px), replace it with a ground pickup. Defensive world-bounds cleanup
    // catches any projectile that somehow escapes (shouldn't happen because
    // target is clamped, but cheap insurance).
    updatePotionProjectiles ()
    {
        const kids = this.potionProjectiles.getChildren().slice();
        for (const proj of kids)
        {
            if (!proj || !proj.active) continue;

            const pk = proj.getData('potionKey');
            const tx = proj.getData('targetX');
            const ty = proj.getData('targetY');

            const ddx = tx - proj.x;
            const ddy = ty - proj.y;
            // 8px proximity threshold -- matches the spec flowchart and is
            // a bit larger than POTION_PROJECTILE_RADIUS to guarantee we
            // never skip past the target between frames at THROW_SPEED.
            if (ddx * ddx + ddy * ddy <= 8 * 8)
            {
                proj.destroy();
                this.spawnGroundPotion(pk, tx, ty);
                continue;
            }

            if (proj.x < 0 || proj.y < 0 ||
                proj.x > this.worldWidth || proj.y > this.worldHeight)
            {
                proj.destroy();
            }
        }
    }

    // Turn a landed projectile into a pickup. Immovable so a player walking
    // into it doesn't shove it; the overlap callback will trigger the pickup.
    spawnGroundPotion (potionKey, x, y)
    {
        const ground = this.potionGroundItems.create(x, y, `potion_${potionKey}`);
        ground.body.setCircle(POTION_GROUND_RADIUS);
        ground.body.setImmovable(true);
        ground.body.setVelocity(0, 0);
        ground.setData('potionKey', potionKey);
        ground.setData('spawnTime', this.time.now);
    }

    // Pulse the ground pickups and despawn any that have aged past
    // POTION_GROUND_LIFETIME_MS. The pulse is a slow sine in alpha so the
    // player can see where potions are without them being distracting.
    updatePotionGroundItems ()
    {
        const kids = this.potionGroundItems.getChildren().slice();
        for (const ground of kids)
        {
            if (!ground || !ground.active) continue;
            const age = this.time.now - ground.getData('spawnTime');
            const t = age / 1000;
            // 0.6 baseline + 0.4 swing => alpha oscillates 0.6..1.0.
            ground.setAlpha(0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 4)));
            if (age >= POTION_GROUND_LIFETIME_MS)
            {
                ground.destroy();
            }
        }
    }

    // Any friendly overlap consumes the potion and sets/refreshes the buff.
    // `player` is whichever friendly entity triggered the overlap -- today
    // always this.player, but allies will flow through here unchanged.
    onPickupPotion (player, potion)
    {
        if (!potion.active) return;
        const potionKey = potion.getData('potionKey');
        // Pickup always sets activeBuffs to now+DURATION (not extends),
        // matching the spec: "re-pickup refreshes to 3s".
        this.activeBuffs[potionKey] = this.time.now + POTION_BUFF_DURATION_MS;
        potion.destroy();

        AudioManager.playSfx(this, 'potion_pickup');
    }

    // Per-frame HUD update. Only runs for the medic (guarded by the null
    // check in update()), so we can assume this.potionHud is populated.
    updatePotionHud ()
    {
        for (const potionKey of POTION_ORDER)
        {
            const slot = this.potionHud[potionKey];
            const potionDef = POTIONS[potionKey];
            const cdRemaining = this.potionCooldowns[potionKey] - this.time.now;

            if (cdRemaining > 0)
            {
                slot.rect.setFillStyle(potionDef.color, 0.3);
                // ceil so the counter shows "7...6...5..." instead of ever
                // flashing "0" on the frame before it unlocks.
                slot.cdText.setText(String(Math.ceil(cdRemaining / 1000)));
            }
            else
            {
                slot.rect.setFillStyle(potionDef.color, 0.9);
                slot.cdText.setText('');
            }

            // Active-buff outline -- a bright white ring on the slot while
            // the corresponding buff is live on the player.
            if (this.time.now < this.activeBuffs[potionKey])
            {
                slot.rect.setStrokeStyle(3, 0xffffff, 1);
            }
            else
            {
                slot.rect.setStrokeStyle();
            }
        }
    }

    // Return the multiplier to apply to a given stat right now. 1.0 when no
    // buff is active so callers can always multiply unconditionally.
    getBuffMultiplier (potionKey)
    {
        return this.time.now < this.activeBuffs[potionKey]
            ? POTIONS[potionKey].buffMultiplier
            : 1.0;
    }

    // Create one enemy at (x, y), add it to the enemies group, give it a
    // circular hit area that matches the visual, and keep it inside the world.
    //
    // enemyKey is optional. If omitted (as in the boss minion spawn path)
    // we fall back to DEFAULT_ENEMY_KEY = 'grunt', so every pre-existing
    // call site keeps its current behavior without edits.
    spawnEnemy (x, y, enemyKey)
    {
        const key = enemyKey || DEFAULT_ENEMY_KEY;
        const def = ENEMIES[key] || ENEMIES[DEFAULT_ENEMY_KEY];

        const enemy = this.enemies.create(x, y, `enemy_${key}`);
        enemy.body.setCircle(def.radius);
        enemy.setCollideWorldBounds(true);

        // Per-enemy combat state. speed is stored on the sprite (not a
        // hardcoded constant) so updateEnemies() can route tanks/grunts
        // through the same loop without special-casing. enemyKey is kept
        // for future per-type behavior hooks (e.g. tank-only knockback res).
        enemy.setData('enemyKey', key);
        enemy.setData('hp', def.hp);
        enemy.setData('speed', def.speed);
        enemy.setData('lastHitTime', 0);

        // HUD readout of remaining enemies has to tick on spawn as well as on
        // kill, otherwise the top-right count lags by one at wave start.
        this.updateEnemiesText();
        return enemy;
    }

    // Roll the enemy type for a given wave. Grunt-only before L4, then ramp
    // tank chance linearly from 20% at L4 to 40% at L10, and hold at 40%
    // through L14. Levels 15+ aren't called here (boss fight owns spawning).
    pickEnemyKeyForLevel (level)
    {
        if (level < 4) return 'grunt';
        const tankChance = Math.min(0.4, 0.2 + (level - 4) * (0.2 / 6));
        return Math.random() < tankChance ? 'tank' : 'grunt';
    }

    // Each frame, steer every enemy straight toward the player at its own
    // per-type speed. Speed lives on the sprite (setData in spawnEnemy) so
    // grunts and tanks share this loop without a type check.
    updateEnemies ()
    {
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

            const speed = enemy.getData('speed');
            enemy.body.setVelocity(dx * speed, dy * speed);
        });
    }

    // Bullet overlapping an enemy: consume the bullet, take 1 hp off the
    // enemy, and destroy it if hp has reached zero.
    //
    // We short-circuit on a 'consumed' data flag rather than !bullet.active
    // because Arcade Physics can re-invoke this callback for the same
    // (bullet, enemy) pair within the same tick -- bullet.destroy() doesn't
    // synchronously stop the already-queued overlap resolution. The data
    // flag is set *before* destroy so the very next callback entry bails
    // out cleanly. Masked on enemies today (hp=1) but matters for the boss.
    onBulletHitEnemy (bullet, enemy)
    {
        if (bullet.getData('consumed') || !enemy.active) return;

        bullet.setData('consumed', true);
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
            AudioManager.playSfx(this, 'enemy_death');

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
        else
        {
            // Non-lethal hit feedback. Only meaningful for tanks (hp=5) and
            // any future multi-HP variants; grunts (hp=1) always fold into
            // the lethal branch above.
            AudioManager.playSfx(this, 'bullet_impact');
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
            // Lethal hit: play the death SFX instead of the hit SFX so we
            // don't stack two sounds on the same frame.
            AudioManager.playSfx(this, 'player_death');
            // Latch so any further overlap callbacks on this frame are no-ops.
            this.playerDead = true;
            this.scene.start('GameOver');
        }
        else
        {
            AudioManager.playSfx(this, 'player_hit');
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
            this.spawnEnemy(x, y, this.pickEnemyKeyForLevel(level));
        }

        // spawnEnemy already updates the HUD per enemy, but call once more so
        // the count is authoritative in the (future) edge case where a wave
        // starts with zero enemies.
        this.updateEnemiesText();
    }

    // Called the moment the last living member of this.enemies is destroyed.
    // For levels 1-13 this advances to the next wave; clearing level 14
    // routes into the boss fight. During the boss fight this fires on every
    // minion's death but the bossActive guard makes it a no-op.
    onWaveCleared ()
    {
        // Boss fight owns its own end conditions; minion kills during
        // level 15 must not re-trigger the normal "wave cleared -> next
        // level" path. Also a no-op if the player died on the killing
        // frame (scene is tearing down).
        if (this.playerDead || this.bossActive) return;

        // After the guards so the SFX only fires on an actual clear, not
        // on minion deaths during the boss fight.
        AudioManager.playSfx(this, 'wave_clear');

        if (this.currentLevel >= this.lastNormalLevel)
        {
            // Level 14 cleared -> advance into the boss after the same 3s
            // intermission used between normal waves, so the pacing stays
            // consistent. The banner text is the only thing that differs.
            this.currentLevel = this.lastNormalLevel + 1;
            this.showBanner(
                `Level ${this.lastNormalLevel} Cleared!`,
                'Boss incoming...',
                this.intermissionMs
            );
            this.time.delayedCall(this.intermissionMs, () => {
                if (this.playerDead) return;
                this.startBossLevel();
            });
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

    // Kick off the level 15 boss encounter. Called from onWaveCleared() after
    // the level-14 intermission. Sets the "we're in the boss fight" flag,
    // swaps in boss-specific HUD, spawns the boss, and registers the three
    // boss-specific overlaps.
    startBossLevel ()
    {
        this.currentLevel = 15;
        this.updateLevelText();
        this.bossActive = true;

        // Swap music immediately so the boss banner lands with the new
        // track underneath it.
        AudioManager.playMusic(this, 'music_boss');

        // The enemies counter is replaced by the boss HP bar, so hide it
        // outright rather than repurposing it. The flag gets cleared if we
        // ever need to show it again (we don't in the current scope).
        this.enemiesText.setVisible(false);

        this.showBanner('BOSS FIGHT', 'Defeat the Purple Menace', 2000);

        // Reuse createPlayerTexture so the boss gets the same directional
        // nub as the player (rotation is visible, same as regular enemies
        // would look if they rotated). Guarded so reruns don't rebuild it.
        if (!this.textures.exists('boss'))
        {
            this.createPlayerTexture('boss', BOSS.radius, BOSS.color, BOSS.color_nub);
        }

        // Spawn at a deterministic offset from world center. Keeps the fight
        // from starting inside the player's face on respawn.
        const spawnX = this.worldWidth / 2 + 400;
        const spawnY = this.worldHeight / 2;

        this.boss = this.physics.add.sprite(spawnX, spawnY, 'boss');
        this.boss.body.setCircle(BOSS.radius);
        this.boss.setCollideWorldBounds(true);
        this.boss.setData('hp', BOSS.hp);
        this.boss.setData('maxHp', BOSS.hp);
        // Reuses the per-enemy contact-damage-cooldown pattern: the last
        // time this boss dealt touch damage, in ms since scene start.
        this.boss.setData('lastHitTime', 0);

        // Timers start at scene time so the first slam/burst/spawn fires
        // after a full interval, not instantly at boss spawn.
        this.bossLastSlamTime = this.time.now;
        this.bossLastBurstTime = this.time.now;
        this.bossLastMinionSpawnTime = this.time.now;
        // State machine: idle -> telegraphing -> dashing -> idle.
        this.bossSlamState = 'idle';

        // Boss bullet group + texture. Lighter purple than the boss itself
        // so the projectiles stay visible against the 0x1a1a1a floor.
        this.bossBullets = this.physics.add.group();
        if (!this.textures.exists('bossBullet'))
        {
            this.createCircleTexture('bossBullet', BOSS.burstBulletRadius, 0xaa66ff);
        }

        // HP bar UI. 600px wide top-center, all pinned to the camera so it
        // doesn't scroll with the world. Stored on `this` because
        // onBossDefeated() needs to tear them down.
        this.bossLabel = this.add.text(this.scale.width / 2, 50, 'BOSS', {
            fontFamily: 'Arial Black', fontSize: 22,
            color: '#ffffff', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5, 0).setScrollFactor(0);

        const barWidth = 600;
        const barHeight = 20;
        const barX = (this.scale.width - barWidth) / 2;
        const barY = 80;

        this.bossBarBg = this.add.rectangle(barX, barY, barWidth, barHeight, 0x333333)
            .setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, 0xffffff);
        this.bossBarFill = this.add.rectangle(barX, barY, barWidth, barHeight, BOSS.color)
            .setOrigin(0, 0).setScrollFactor(0);
        this.bossBarWidth = barWidth;

        // Register overlaps. Using overlap (not collider) so the boss
        // doesn't physically shove the player on contact -- the slam's
        // threat is the damage value, not the shove.
        this.physics.add.overlap(this.bullets, this.boss, this.onBulletHitBoss, null, this);
        this.physics.add.overlap(this.player, this.boss, this.onBossTouchPlayer, null, this);
        this.physics.add.overlap(this.player, this.bossBullets, this.onBossBulletHitPlayer, null, this);
    }

    // Per-frame boss behavior. Runs from update() only while bossActive and
    // boss.active. Rotates the boss to face the player, ticks the slam state
    // machine, and fires timed burst/minion attacks.
    updateBoss ()
    {
        const boss = this.boss;
        const player = this.player;
        const now = this.time.now;

        // Face the player every frame so the directional nub always points
        // at them. This is cosmetic outside the dash; during telegraph
        // you see the nub track toward where the dash will commit.
        boss.rotation = Math.atan2(player.y - boss.y, player.x - boss.x);

        // --- Slam state machine ---------------------------------------------
        if (this.bossSlamState === 'idle')
        {
            // Chase at chaseSpeed, same normalize pattern as regular enemies.
            let dx = player.x - boss.x;
            let dy = player.y - boss.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len === 0)
            {
                boss.body.setVelocity(0, 0);
            }
            else
            {
                dx /= len;
                dy /= len;
                boss.body.setVelocity(dx * BOSS.chaseSpeed, dy * BOSS.chaseSpeed);
            }

            if (now - this.bossLastSlamTime >= BOSS.slamIntervalMs)
            {
                this.bossSlamState = 'telegraphing';
                this.bossTelegraphStartTime = now;
                boss.body.setVelocity(0, 0);
                // Yellow tint = "wind-up". This is the player's only cue
                // that a high-damage dash is imminent.
                boss.setTint(0xffff00);
                AudioManager.playSfx(this, 'boss_telegraph');
            }
        }
        else if (this.bossSlamState === 'telegraphing')
        {
            // Stay still during the wind-up; the dash angle is locked at the
            // end of telegraph, not at the start, so the player can still
            // dodge by moving during the yellow-tint window.
            boss.body.setVelocity(0, 0);

            if (now - this.bossTelegraphStartTime >= BOSS.slamTelegraphMs)
            {
                boss.clearTint();
                this.bossDashAngle = Math.atan2(player.y - boss.y, player.x - boss.x);
                boss.body.setVelocity(
                    Math.cos(this.bossDashAngle) * BOSS.slamDashSpeed,
                    Math.sin(this.bossDashAngle) * BOSS.slamDashSpeed
                );
                this.bossDashStartTime = now;
                this.bossSlamState = 'dashing';
                AudioManager.playSfx(this, 'boss_slam');
            }
        }
        else if (this.bossSlamState === 'dashing')
        {
            // Velocity was set at the transition into 'dashing' and we
            // intentionally don't re-aim mid-dash -- that's what makes it
            // dodgeable. When the duration is up, stop and begin recovery.
            if (now - this.bossDashStartTime >= BOSS.slamDashDurationMs)
            {
                boss.body.setVelocity(0, 0);
                this.bossSlamState = 'idle';
                // Recovery timer starts from the end of the dash so the
                // next telegraph is slamIntervalMs later, not
                // slamIntervalMs - dashDuration - telegraphMs later.
                this.bossLastSlamTime = now;
            }
        }

        // --- Radial burst ---------------------------------------------------
        if (now - this.bossLastBurstTime >= BOSS.burstIntervalMs)
        {
            // One SFX per burst, not per bullet, or we'd stack ~12
            // overlapping samples.
            AudioManager.playSfx(this, 'boss_burst');
            for (let i = 0; i < BOSS.burstBulletCount; i++)
            {
                const angle = (i * Math.PI * 2) / BOSS.burstBulletCount;
                this.fireBossBullet(angle);
            }
            this.bossLastBurstTime = now;
        }

        // --- Minion spawn ---------------------------------------------------
        if (now - this.bossLastMinionSpawnTime >= BOSS.minionSpawnIntervalMs &&
            this.enemies.countActive(true) < BOSS.minionCap)
        {
            for (let i = 0; i < BOSS.minionsPerSpawn; i++)
            {
                const angle = Math.random() * Math.PI * 2;
                const dist = 100 + Math.random() * 100;
                const mx = boss.x + Math.cos(angle) * dist;
                const my = boss.y + Math.sin(angle) * dist;
                this.spawnEnemy(mx, my);
            }
            this.bossLastMinionSpawnTime = now;
        }
    }

    // Spawn one bullet from the boss at the supplied absolute angle.
    // Mirrors fireSingleBullet's setData shape (spawnX/Y/rangeSq) so the
    // cleanup logic in updateBossBullets() is a straight copy.
    fireBossBullet (angle)
    {
        const boss = this.boss;
        const bullet = this.bossBullets.create(boss.x, boss.y, 'bossBullet');
        bullet.body.setCircle(BOSS.burstBulletRadius);
        bullet.body.setVelocity(
            Math.cos(angle) * BOSS.burstBulletSpeed,
            Math.sin(angle) * BOSS.burstBulletSpeed
        );
        bullet.setData('spawnX', boss.x);
        bullet.setData('spawnY', boss.y);
        bullet.setData('rangeSq', BOSS.burstBulletRange * BOSS.burstBulletRange);
    }

    // Cleanup for boss bullets -- same shape as the player-bullet cleanup in
    // update(), just over its own group. Destroys any that have exceeded
    // their range or left the world.
    updateBossBullets ()
    {
        this.bossBullets.getChildren().slice().forEach((bullet) => {
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
    }

    // Scale the HP bar fill to match the boss's remaining HP. Ratio is
    // clamped to 0 so a negative-HP killing blow doesn't produce a negative
    // width for the single frame before onBossDefeated() tears the bar down.
    updateBossBar ()
    {
        const ratio = Math.max(0, this.boss.getData('hp') / this.boss.getData('maxHp'));
        this.bossBarFill.width = this.bossBarWidth * ratio;
    }

    // Player bullet hits the boss. Mirrors onBulletHitEnemy but with the
    // boss's setData hp/maxHp and no wave-clear plumbing; when HP reaches 0
    // we dispatch to onBossDefeated() which owns the full teardown.
    //
    // Uses the same 'consumed' flag pattern as onBulletHitEnemy -- see the
    // comment there for the rationale. The boss is the first entity with >1
    // HP, which is why this bug was invisible until level 15.
    //
    // IMPORTANT: arg order is (boss, bullet), NOT (bullet, boss). Phaser's
    // collideSpriteVsGroup(spriteSide, groupSide, cb) always invokes cb with
    // the single sprite first, regardless of the order passed to overlap().
    // We register overlap(this.bullets, this.boss, ...), so Phaser routes it
    // as collideSpriteVsGroup(boss, bullets) internally and the callback
    // receives (boss, bullet). onBulletHitEnemy is unaffected because both
    // of its sides are groups (collideGroupVsGroup honors registration order).
    onBulletHitBoss (boss, bullet)
    {
        if (bullet.getData('consumed') || !boss.active) return;

        bullet.setData('consumed', true);
        bullet.destroy();

        // Hit feedback on every bullet (boss has enough HP that this plays
        // many times per fight, unlike enemies which fold to one hit).
        // boss_death is NOT played here -- onBossDefeated() owns it so all
        // teardown sounds live in one place.
        AudioManager.playSfx(this, 'bullet_impact');

        const damage = bullet.getData('damage') || 1;
        const newHp = boss.getData('hp') - damage;
        boss.setData('hp', newHp);

        if (newHp <= 0)
        {
            this.onBossDefeated();
        }
    }

    // Boss body overlapping the player. Damage is a flat slamDamage (40)
    // whether the boss is chasing or dashing -- the dash just makes it
    // easier to land the hit. Respects a per-boss cooldown so continuous
    // contact doesn't drain the player's HP in a single frame.
    onBossTouchPlayer (player, boss)
    {
        if (this.playerDead || !boss.active) return;

        const now = this.time.now;
        if (now - boss.getData('lastHitTime') < BOSS.slamContactCooldownMs) return;
        boss.setData('lastHitTime', now);

        this.playerHp -= BOSS.slamDamage;
        this.updateHpText();
        this.flashPlayerHit();

        if (this.playerHp <= 0)
        {
            AudioManager.playSfx(this, 'player_death');
            this.playerDead = true;
            this.scene.start('GameOver');
        }
        else
        {
            AudioManager.playSfx(this, 'player_hit');
        }
    }

    // A boss bullet hit the player. Each bullet is one-shot -- destroy on
    // contact so the player can't get ticked twice by the same projectile.
    // Uses the same 'consumed' flag pattern as onBulletHitEnemy /
    // onBulletHitBoss so a bullet that overlaps the player for multiple
    // physics steps doesn't drain HP repeatedly.
    onBossBulletHitPlayer (player, bullet)
    {
        if (this.playerDead) return;
        if (bullet.getData('consumed')) return;

        bullet.setData('consumed', true);
        bullet.destroy();

        this.playerHp -= BOSS.burstBulletDamage;
        this.updateHpText();
        this.flashPlayerHit();

        if (this.playerHp <= 0)
        {
            AudioManager.playSfx(this, 'player_death');
            this.playerDead = true;
            this.scene.start('GameOver');
        }
        else
        {
            AudioManager.playSfx(this, 'player_hit');
        }
    }

    // Boss HP reached 0. Clear the fight state, destroy every boss-related
    // entity + HUD element, show a victory banner, and queue a transition
    // to the Victory scene after the banner finishes.
    onBossDefeated ()
    {
        this.bossActive = false;

        AudioManager.playSfx(this, 'boss_death');

        if (this.boss) { this.boss.destroy(); this.boss = null; }
        if (this.bossLabel) this.bossLabel.destroy();
        if (this.bossBarBg) this.bossBarBg.destroy();
        if (this.bossBarFill) this.bossBarFill.destroy();

        // Remove living minions + in-flight boss bullets so the victory
        // banner isn't accompanied by red enemies still chasing or purple
        // bullets still flying.
        this.enemies.getChildren().slice().forEach(e => e.destroy());
        if (this.bossBullets) this.bossBullets.getChildren().slice().forEach(b => b.destroy());

        this.showBanner('VICTORY!', 'You have defeated the Purple Menace', 3000);

        // playerDead guard: the victory transition fires 3s after the boss
        // dies, during which the player can still be touched by a leftover
        // minion spawned on the same frame. If that kills them, the
        // GameOver scene is already running and we skip the duplicate --
        // losing-while-winning correctly ends on GameOver.
        this.time.delayedCall(3000, () => {
            if (!this.playerDead) this.scene.start('Victory', { classKey: this.classKey });
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
