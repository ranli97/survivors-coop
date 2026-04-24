// Player-class data. Kept in a plain data module (no Phaser imports) so the
// menu scene and the gameplay scene can both read from a single source of
// truth. Each entry is fully self-describing -- if you add a new class, add
// it here and it'll flow through ClassSelect + Game with no other edits.
//
// Fields:
//   key            - string; must match the object key above.
//   name           - display name used in the menu and HUD.
//   color          - 0xRRGGBB fill color for the player circle sprite.
//   description    - one-sentence card blurb.
//   hp             - starting / max player HP.
//   speed          - movement speed in px/sec (see Game.js update()).
//   weapon         - 'pistol' | 'shotgun' | 'sniper' | 'mg'. Drives which
//                    branch of fireWeapon() runs.
//   fireRateMs     - min ms between trigger pulls.
//   bulletDamage   - dmg applied per bullet in onBulletHitEnemy.
//   bulletSpeed    - bullet velocity in px/sec.
//   bulletRange    - max distance a bullet travels before being cleaned up.
//   pellets        - shotgun only: bullets per shot.
//   spreadDegrees  - shotgun only: full cone width.
//   jitterDegrees  - mg only: per-shot random angle deviation (+/- half).
export const CLASSES = {
    brawler: {
        key: 'brawler',
        name: 'Brawler',
        color: 0xff8800,
        description: 'Shotgun specialist. Devastating up close.',
        hp: 120,
        speed: 200,
        weapon: 'shotgun',
        fireRateMs: 667,
        bulletDamage: 15,
        bulletSpeed: 500,
        bulletRange: 400,
        pellets: 6,
        spreadDegrees: 20
    },
    sniper: {
        key: 'sniper',
        name: 'Sniper',
        color: 0x3388ff,
        description: 'One shot, one kill. Fragile at close range.',
        hp: 80,
        speed: 180,
        weapon: 'sniper',
        fireRateMs: 1000,
        bulletDamage: 100,
        bulletSpeed: 1200,
        bulletRange: 1500
    },
    gunner: {
        key: 'gunner',
        name: 'Gunner',
        color: 0x44dd44,
        description: 'Rapid fire. Great vs. crowds.',
        hp: 100,
        speed: 200,
        weapon: 'mg',
        fireRateMs: 83,
        bulletDamage: 10,
        bulletSpeed: 600,
        bulletRange: 600,
        jitterDegrees: 3
    },
    medic: {
        key: 'medic',
        name: 'Medic',
        color: 0xffffff,
        description: 'Support. Healing comes in a future update.',
        hp: 100,
        speed: 220,
        weapon: 'pistol',
        fireRateMs: 250,
        bulletDamage: 8,
        bulletSpeed: 600,
        bulletRange: 500,
        // Healing aura -- exclusive to the medic. The gameplay scene checks
        // `canHeal === true` before running any healing logic, so omitting
        // these fields on other classes is what keeps RMB inert for them.
        canHeal: true,
        healRadius: 150,
        healPerSecond: 10,
        // Throwable potions -- also medic-only. Kept as a separate flag from
        // canHeal so the two subsystems can be enabled independently later
        // (e.g. a future support class could throw potions without healing).
        canThrowPotions: true
    }
};

// Fallback used by Game.init() if the scene is started directly (e.g. from a
// dev tool) without a classKey. 'gunner' is the closest analogue to the
// pre-class gameplay: green, HP 100, speed 200, moderate rate of fire.
export const DEFAULT_CLASS_KEY = 'gunner';
