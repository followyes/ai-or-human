export const GAME_MODE_IDS = Object.freeze({
  CLASSIC: "classic",
  SPEED_RUN: "speed-run"
});

const GAME_MODE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: GAME_MODE_IDS.CLASSIC,
    label: "Klasyczny",
    description: "Zgaduj, kto stworzył obraz",
    enabled: true
  }),
  Object.freeze({
    id: GAME_MODE_IDS.SPEED_RUN,
    label: "Speed Run",
    description: "Zgaduj, zanim skończy się czas",
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
