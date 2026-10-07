export const GAME_MODE_IDS = Object.freeze({
  CLASSIC: "classic"
});

const GAME_MODE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: GAME_MODE_IDS.CLASSIC,
    label: "Klasyczny",
    description: "Zgaduj, kto stworzył obraz",
    enabled: true
  })
]);

export function getGameModes() {
  return GAME_MODE_DEFINITIONS;
}

export function getGameModeDefinition(modeId) {
  return GAME_MODE_DEFINITIONS.find((mode) => mode.id === modeId) ?? null;
}

export function isGameModeSelectable(modeId) {
  return Boolean(getGameModeDefinition(modeId)?.enabled);
}
