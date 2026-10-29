/** Synthetic prepared-data fixtures shaped like PF2e 8.6.1 creatures. No real Actor or world data. */
const permission = (user, level) => user?.id === "viewer" && level === "OBSERVER";
const condition = (name, value = null) => ({ type: "condition", name, system: { slug: name.toLowerCase(), value: value === null ? { isValued: false, value: null } : { isValued: true, value } } });

export function createPf2eCharacter() {
  return {
    id: "pf2epc", uuid: "Actor.pf2epc", documentName: "Actor", type: "character", name: "Synthetic champion",
    img: "assets/synthetic-portrait.webp", testUserPermission: permission,
    system: {
      attributes: {
        hp: { value: 31, max: 52, temp: 5, unrecoverable: 0, negativeHealing: false }, ac: { value: 21, breakdown: "PRIVATE breakdown" },
        dying: { value: 1, max: 4, recoveryDC: 11 }, wounded: { value: 1, max: 3 }, doomed: { value: 0, max: 3 },
        shield: { itemId: "shield", name: "Steel shield", ac: 2, hardness: 5, brokenThreshold: 10, hp: { value: 14, max: 20 }, raised: false, broken: false, destroyed: false }
      },
      details: { level: { value: 4 }, xp: { value: 650, min: 0, max: 1000, pct: 65 },
        class: { name: "Champion", trait: "champion" }, ancestry: { name: "Dwarf", trait: "dwarf" }, heritage: { name: "Forge Dwarf", trait: null },
        biography: { appearance: "PRIVATE biography" } },
      perception: { totalModifier: 9, value: 9, dc: 19, mod: 9 },
      saves: { fortitude: { totalModifier: 12, value: 12 }, reflex: { totalModifier: 7, value: 7 }, will: { totalModifier: 10, value: 10 } },
      abilities: { str: { mod: 4 }, dex: { mod: 0 }, con: { mod: 2 }, int: { mod: -1 }, wis: { mod: 1 }, cha: { mod: 3 } },
      resources: { heroPoints: { value: 2, max: 3 }, focus: { value: 1, max: 2, cap: 3 } }
    },
    items: { contents: [{ type: "class", name: "Champion" }, condition("Frightened", 2), condition("Off-Guard"), { type: "effect", name: "Not a condition" }] }
  };
}

export function createPf2eNpc() {
  return {
    id: "pf2enpc", uuid: "Actor.pf2enpc", documentName: "Actor", type: "npc", name: "Synthetic dragon",
    img: "assets/synthetic-dragon.webp", testUserPermission: permission,
    system: {
      attributes: { hp: { value: 180, max: 240, temp: 0 }, ac: { value: 33 }, dying: { value: 0, max: 4 }, wounded: { value: 0, max: 3 }, doomed: { value: 0, max: 3 } },
      details: { level: { value: 12 } },
      perception: { totalModifier: 24 },
      saves: { fortitude: { totalModifier: 25 }, reflex: { totalModifier: 21 }, will: { totalModifier: 23 } },
      abilities: { str: { mod: 7 }, dex: { mod: 3 }, con: { mod: 6 }, int: { mod: 2 }, wis: { mod: 4 }, cha: { mod: 5 } },
      resources: {}
    },
    items: { contents: [condition("Frightened", 1)] }
  };
}
