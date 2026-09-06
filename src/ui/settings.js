import { CAMERA_PRESETS } from '../render/renderer.js';

const SETTINGS_KEY = 'rocketgoal.settings.v1';

export function defaultSettings() {
  return {
    teamSize: 1,
    difficulty: 'allstar',
    duration: 300,
    humanTeam: 0,
    boostMutator: 'normal',
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
    return s;
  } catch (e) {
    return defaultSettings();
  }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
