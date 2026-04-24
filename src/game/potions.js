// Throwable potions. Plain data module (no Phaser imports) -- both the
// gameplay scene and any future UI can read from a single source of truth.
//
// Each potion entry:
//   key            - matches the object key, used in activeBuffs/cooldowns.
//   name           - short HUD label ("DMG", "SPD", "FIRE").
//   color          - 0xRRGGBB used for projectile/ground sprite and HUD slot.
//   buffMultiplier - applied to the relevant stat while the buff is active.
//                    For damage and speed this is >1 (stronger/faster).
//                    For fireRate it is <1 -- fireRateMs is an interval, so
//                    a smaller number means a faster gun.
export const POTIONS = {
    damage:   { key: 'damage',   name: 'DMG',  color: 0xff4444, buffMultiplier: 1.5 },
    speed:    { key: 'speed',    name: 'SPD',  color: 0xffff44, buffMultiplier: 1.4 },
    fireRate: { key: 'fireRate', name: 'FIRE', color: 0x44ffff, buffMultiplier: 0.6 }
};

// Deterministic order for the 1 / 2 / 3 hotkey mapping and HUD slot order.
// Decoupled from Object.keys(POTIONS) so reordering the data object can't
// silently change the keybindings.
export const POTION_ORDER = ['damage', 'speed', 'fireRate'];

// Tuning knobs -- exported so Game.js doesn't have to re-declare them.
export const POTION_COOLDOWN_MS = 7000;
export const POTION_BUFF_DURATION_MS = 3000;
export const POTION_GROUND_LIFETIME_MS = 5000;
export const POTION_THROW_SPEED = 800;
export const POTION_MAX_RANGE = 500;
export const POTION_PICKUP_RADIUS = 14;
export const POTION_PROJECTILE_RADIUS = 6;
export const POTION_GROUND_RADIUS = 12;
