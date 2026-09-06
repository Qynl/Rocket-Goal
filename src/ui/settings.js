import { CAMERA_PRESETS } from '../render/renderer.js';
import { defaultMutators } from '../mutators.js';

const SETTINGS_KEY = 'rocketgoal.settings.v1';

export function defaultSettings() {
  return {
    teamSize: 1,
    difficulty: 'allstar',
    duration: 300,
    humanTeam: 0,
    mutators: defaultMutators(),
    arena: 'stadium',
    loadout: { car: 'octane', primary: 0x1b3f9e, secondary: 0x0e1220, finish: 'glossy', wheels: 'spoke', trail: 'default', explosion: 'default' },
    camera: { ...CAMERA_PRESETS.default },
    quality: 'high',
    replays: true,
    showPrediction: false,
    coach: true,
    quickChat: true,
    volume: 0.6,
    playerName: 'You',
    drillLevel: 1,
    lastDrill: 'shooting',
  };
}

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const s = { ...defaultSettings(), ...stored };
    s.camera = { ...defaultSettings().camera, ...(stored.camera || {}) };
    s.mutators = { ...defaultMutators(), ...(stored.mutators || {}) };
    s.loadout = { ...defaultSettings().loadout, ...(stored.loadout || {}) };
    // back-compat with the old single boost mutator toggle
    if (stored.boostMutator === 'unlimited' && !stored.mutators) s.mutators.boost = 'unlimited';
    if (typeof s.duration !== 'number') s.duration = 300;
    return s;
  } catch (e) {
    return defaultSettings();
  }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
