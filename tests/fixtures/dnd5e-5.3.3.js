/** Synthetic prepared-data fixture. No real Actor or world data. */
export function createDnd5e533Actor() {
  return {
    id: "dndpc", uuid: "Actor.dndpc", documentName: "Actor", type: "character", name: "Synthetic adventurer",
    img: "assets/synthetic-portrait.webp", prototypeToken: { texture: { src: "assets/synthetic-token.webp" } },
    testUserPermission: (user, level) => user?.id === "viewer" && level === "OBSERVER",
    system: {
      attributes: { hp: { value: 36, max: 40, tempmax: 8, effectiveMax: 48, temp: 7 }, ac: { value: 19, flat: 12 } },
      details: { level: 5, biography: { value: "PRIVATE fixture text" } },
      abilities: {
        str: { value: 18, mod: 4 }, dex: { value: 14, mod: 2 }, con: { value: 12, mod: 1 },
        int: { value: 8, mod: -1 }, wis: { value: 10, mod: 0 }, cha: { value: 16, mod: 3 }
      },
      resources: {
        primary: { value: 2, max: 4, label: "Focus" }, secondary: { value: 0, max: 3, label: "Recovery" },
        tertiary: { value: 1, max: 1, label: "Feature" }
      }
    },
    // Prepared values above can differ from source values because of effects and multiclass preparation.
    _source: { system: { attributes: { hp: { max: 40 }, ac: { value: 12 } }, details: { level: 0 },
      abilities: { str: { value: 14, mod: 2 } } } },
    items: [{ type: "class", name: "Fighter", system: { levels: 3 } }, { type: "class", name: "Wizard", system: { levels: 2 } }],
    effects: [{ name: "Synthetic bonus", changes: [{ key: "system.abilities.str.value", value: "4" }] }]
  };
}
