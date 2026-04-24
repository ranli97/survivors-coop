// AudioManager
// ------------
// Centralized audio routing + volume state for the game. Every scene that
// wants to play a sound calls AudioManager.playSfx(this, key) or
// playMusic(this, key) -- the "pass scene per call" pattern completely
// eliminates stale-scene-reference bugs that show up when Phaser tears down
// a scene (e.g. Game -> GameOver) and the stored scene ref becomes inert.
//
// Effective volume is master * (musicVolume | sfxVolume) * (muted ? 0 : 1),
// then multiplied by any per-call options.volume.
//
// Volume prefs + mute flag are persisted to localStorage so the user's menu
// sliders survive a page refresh.

const STORAGE_KEY = 'survivors-coop/audio';
const FADE_MS = 500;

const DEFAULTS = {
    master: 1.0,
    sfx: 0.5,
    music: 0.4,
    muted: false
};

// Module-scoped state. Not on the AudioManager object itself so callers
// can't mutate it directly and bypass persistence.
let state = { ...DEFAULTS };

// The currently playing music Sound instance. Module-scoped because Phaser's
// SoundManager is global (shared across scenes), so there's exactly one
// "current track" regardless of which scene is active.
let currentMusic = null;

// --- persistence --------------------------------------------------------

function loadPrefs ()
{
    try
    {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        // Whitelist fields + clamp so a corrupted blob can't push volumes
        // out of range or introduce extra keys.
        if (typeof parsed.master === 'number') state.master = clamp01(parsed.master);
        if (typeof parsed.sfx    === 'number') state.sfx    = clamp01(parsed.sfx);
        if (typeof parsed.music  === 'number') state.music  = clamp01(parsed.music);
        if (typeof parsed.muted  === 'boolean') state.muted = parsed.muted;
    }
    catch (e)
    {
        // Private-browsing / disabled storage -- silently run with defaults.
    }
}

function savePrefs ()
{
    try
    {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    catch (e)
    {
        // Storage quota / private mode -- non-fatal, settings just won't
        // persist across reloads for this user.
    }
}

// --- helpers ------------------------------------------------------------

function clamp01 (v)
{
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    return Math.min(Math.max(v, 0), 1);
}

// Liveness guard. We used to rely on sys.isActive(), but that only returns
// true once the scene has transitioned to RUNNING -- it's false during
// create(), which is exactly when scenes first try to kick off music.
// Instead, duck-type: accept any scene whose systems we actually use are
// reachable. A destroyed scene has sys.isDestroyed() === true (or a null
// sound manager), which the && short-circuits cleanly.
function isSceneUsable (scene)
{
    if (!scene || !scene.sys) return false;
    if (typeof scene.sys.isDestroyed === 'function' && scene.sys.isDestroyed()) return false;
    return !!(scene.sound && scene.tweens && scene.cache && scene.cache.audio);
}

// kind === 'music' | 'sfx'. Centralizes the master * per-channel * mute math
// so setters and playback paths can't drift.
function effective (kind)
{
    const channel = kind === 'music' ? state.music : state.sfx;
    return state.master * channel * (state.muted ? 0 : 1);
}

// --- public API ---------------------------------------------------------

export const AudioManager = {

    // Called once from Boot.create(). Loads persisted prefs -- no scene
    // stored, no playback. Safe to call multiple times (idempotent).
    init ()
    {
        loadPrefs();
    },

    playSfx (scene, key, options)
    {
        if (!isSceneUsable(scene))
        {
            console.warn(`[AudioManager] playSfx('${key}'): scene not usable`);
            return;
        }
        if (!scene.cache.audio.exists(key))
        {
            console.warn(`[AudioManager] SFX not loaded: ${key}`);
            return;
        }

        const opts = options || {};
        const perCallVolume = typeof opts.volume === 'number' ? opts.volume : 1;
        const volume = effective('sfx') * perCallVolume;

        // Short-circuit: if audio is effectively silent, skip the play call
        // entirely to avoid spamming the SoundManager with silent instances.
        if (volume <= 0) return;

        scene.sound.play(key, { ...opts, volume });
    },

    playMusic (scene, key)
    {
        if (!isSceneUsable(scene))
        {
            console.warn(`[AudioManager] playMusic('${key}'): scene not usable`);
            return;
        }
        if (!scene.cache.audio.exists(key))
        {
            console.warn(`[AudioManager] Music not loaded: ${key}`);
            return;
        }

        // Already playing this track -- no-op so scene-to-scene transitions
        // that share a music key (MainMenu -> ClassSelect) don't restart it.
        if (currentMusic && currentMusic.key === key && currentMusic.isPlaying)
        {
            return;
        }

        // Crossfade: fade the outgoing track to 0 then destroy it, in
        // parallel with the new track fading in from 0.
        if (currentMusic)
        {
            const outgoing = currentMusic;
            scene.tweens.add({
                targets: outgoing,
                volume: 0,
                duration: FADE_MS,
                onComplete: () => {
                    // Defensive: instance might already be gone if the scene
                    // tore down mid-fade.
                    if (outgoing)
                    {
                        try { outgoing.stop(); } catch (e) { /* ignore */ }
                        try { outgoing.destroy(); } catch (e) { /* ignore */ }
                    }
                }
            });
        }

        const music = scene.sound.add(key, { loop: true, volume: 0 });
        music.play();
        scene.tweens.add({
            targets: music,
            volume: effective('music'),
            duration: FADE_MS
        });

        currentMusic = music;
    },

    stopMusic (scene)
    {
        if (!currentMusic) return;

        // If no usable scene, stop hard -- we can't tween without a scene's
        // tween manager, but we still want silence.
        if (!isSceneUsable(scene))
        {
            try { currentMusic.stop(); } catch (e) { /* ignore */ }
            try { currentMusic.destroy(); } catch (e) { /* ignore */ }
            currentMusic = null;
            return;
        }

        const outgoing = currentMusic;
        currentMusic = null;
        scene.tweens.add({
            targets: outgoing,
            volume: 0,
            duration: FADE_MS,
            onComplete: () => {
                try { outgoing.stop(); } catch (e) { /* ignore */ }
                try { outgoing.destroy(); } catch (e) { /* ignore */ }
            }
        });
    },

    // --- volume setters ---
    // All setters clamp, persist, and retune the currently playing music
    // (if any) so slider drags in the menu feel instant.

    setMasterVolume (v)
    {
        state.master = clamp01(v);
        savePrefs();
        applyMusicVolumeLive();
    },

    setSfxVolume (v)
    {
        state.sfx = clamp01(v);
        savePrefs();
        // No live update needed -- SFX are fire-and-forget; next call reads
        // the new state.
    },

    setMusicVolume (v)
    {
        state.music = clamp01(v);
        savePrefs();
        applyMusicVolumeLive();
    },

    setMuted (b)
    {
        state.muted = !!b;
        savePrefs();
        applyMusicVolumeLive();
    },

    // --- getters ---

    getMasterVolume () { return state.master; },
    getSfxVolume ()    { return state.sfx; },
    getMusicVolume ()  { return state.music; },
    isMuted ()         { return state.muted; }
};

// Push the current effective music volume onto the active track. Called
// whenever a setter changes a number the music depends on.
function applyMusicVolumeLive ()
{
    if (!currentMusic) return;
    try
    {
        currentMusic.setVolume(effective('music'));
    }
    catch (e)
    {
        // Sound instance may have been destroyed between check and call on
        // teardown; not worth a warning.
    }
}
