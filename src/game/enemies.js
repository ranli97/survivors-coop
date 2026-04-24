// Enemy type definitions. Same data-driven shape as classes.js / potions.js:
// a keyed map + an explicit default so call sites can fall back gracefully
// when an unknown key is passed.
//
// Adding a new enemy type is a one-file change here plus one line in
// Game.pickEnemyKeyForLevel to include it in the spawn roll.
export const ENEMIES = {
    grunt: {
        key: 'grunt',
        hp: 1,
        speed: 100,
        radius: 14,
        color: 0xdd3333
    },
    tank: {
        key: 'tank',
        hp: 5,
        speed: 50,
        radius: 20,
        color: 0x881111
    }
};

// Fallback for spawnEnemy when called without a key (boss minions) or with
// an unknown key (defensive).
export const DEFAULT_ENEMY_KEY = 'grunt';
