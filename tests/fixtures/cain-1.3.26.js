/** Synthetic prepared document shape from the CAIN 1.3.26 schema; no world data. */
export const CAIN_SKILL_KEYS = Object.freeze([
  "force", "conditioning", "coordination", "covert", "interfacing", "investigation", "surveillance", "negotiation", "authority", "connection"
]);
export const CAIN_VIEWER = Object.freeze({ id: "cain-test-viewer", isGM: false });

export function createCainCharacter() {
  return {
    documentName: "Actor", uuid: "Actor.cainFixture", id: "cainFixture", name: "Synthetic CAIN Exorcist", type: "character",
    img: "icons/svg/mystery-man.svg", prototypeToken: { texture: { src: "icons/svg/mystery-man.svg" } },
    testUserPermission: (user, permission) => user?.id === CAIN_VIEWER.id && permission === "OBSERVER",
    system: {
      health: { value: 7, max: 10 }, power: { value: 4, max: 5 }, attributes: { level: { value: 1 } },
      CATLEVEL: { value: 3 }, psyche: 2, psycheBurst: { value: 2, max: 3 },
      stress: { value: 2, max: 6 }, injuries: { value: 1, max: 3 }, divineAgony: { value: 1, max: 3 },
      sinOverflow: { value: 4, max: 10, min: 0 }, kitPoints: { value: 3, max: 5 },
      xp: { value: 2, max: 4 }, advancements: { value: 1, max: 4 }, scrip: 12,
      skills: {
        force: { value: 2, max: 4 }, conditioning: { value: 1, max: 4 }, coordination: { value: 3, max: 4 },
        covert: { value: 0, max: 4 }, interfacing: { value: 4, max: 4 }, investigation: { value: 2, max: 4 },
        surveillance: { value: 1, max: 4 }, negotiation: { value: 3, max: 4 }, authority: { value: 0, max: 4 }, connection: { value: 2, max: 4 }
      },
      extraDice: { value: 1 }, restDiceModifier: -1, XID: "TEST-001", agenda: "Synthetic agenda", blasphemy: "Synthetic blasphemy",
      sex: "Synthetic", height: "170 cm", weight: "70 kg", hair: "Black", eyes: "Brown",
      biography: "PRIVATE FIXTURE BIOGRAPHY", currentAgenda: "PRIVATE-CATALOG-ID", currentBlasphemyPowers: ["PRIVATE-POWER-ID"],
      afflictions: ["PRIVATE-AFFLICTION-ID"], talismans: [{ name: "PRIVATE CLOCK", currMarkAmount: 1 }]
    }
  };
}

/** Explicit expected public scalar projection, intentionally separate from adapter path definitions. */
export const CAIN_EXPECTED_VALUES = Object.freeze({
  "character.hp.current": 7, "character.hp.max": 10, "character.hp.percent": 70, "character.level": 1,
  "character.power.current": 4, "character.power.max": 5, "character.stress.current": 2, "character.stress.max": 6, "character.psyche": 2,
  "character.cain.cat": 3, "character.cain.psycheBurst.current": 2, "character.cain.psycheBurst.max": 3,
  "character.cain.injuries.current": 1, "character.cain.injuries.max": 3,
  "character.cain.divineAgony.current": 1, "character.cain.divineAgony.max": 3,
  "character.cain.sinOverflow.current": 4, "character.cain.sinOverflow.max": 10, "character.cain.sinOverflow.min": 0,
  "character.cain.kitPoints.current": 3, "character.cain.kitPoints.max": 5,
  "character.cain.xp.current": 2, "character.cain.xp.max": 4,
  "character.cain.advancements.current": 1, "character.cain.advancements.max": 4, "character.cain.scrip": 12,
  "character.cain.skills.force.rating": 2, "character.cain.skills.force.max": 4,
  "character.cain.skills.conditioning.rating": 1, "character.cain.skills.conditioning.max": 4,
  "character.cain.skills.coordination.rating": 3, "character.cain.skills.coordination.max": 4,
  "character.cain.skills.covert.rating": 0, "character.cain.skills.covert.max": 4,
  "character.cain.skills.interfacing.rating": 4, "character.cain.skills.interfacing.max": 4,
  "character.cain.skills.investigation.rating": 2, "character.cain.skills.investigation.max": 4,
  "character.cain.skills.surveillance.rating": 1, "character.cain.skills.surveillance.max": 4,
  "character.cain.skills.negotiation.rating": 3, "character.cain.skills.negotiation.max": 4,
  "character.cain.skills.authority.rating": 0, "character.cain.skills.authority.max": 4,
  "character.cain.skills.connection.rating": 2, "character.cain.skills.connection.max": 4,
  "character.cain.extraDice": 1, "character.cain.restDiceModifier": -1,
  "character.cain.xid": "TEST-001", "character.cain.agenda": "Synthetic agenda", "character.cain.blasphemy": "Synthetic blasphemy",
  "character.cain.appearance.sex": "Synthetic", "character.cain.appearance.height": "170 cm", "character.cain.appearance.weight": "70 kg", "character.cain.appearance.hair": "Black", "character.cain.appearance.eyes": "Brown"
});
