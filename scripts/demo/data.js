import { DEMO_ACTOR_UUIDS, isDemoReference } from "./identities.js";

export { DEMO_ACTOR_UUIDS, isDemoReference };

export const DEMO_CHARACTERS = Object.freeze([
  Object.freeze({ uuid: DEMO_ACTOR_UUIDS[0], name: "Demo Warrior", portrait: "modules/modular-stream-overlay/assets/demo-warrior.svg", type: "DEMO DATA" }),
  Object.freeze({ uuid: DEMO_ACTOR_UUIDS[1], name: "Demo Mage", portrait: "modules/modular-stream-overlay/assets/demo-mage.svg", type: "DEMO DATA" })
]);

/** These fields describe the synthetic source only, never the active game-system adapter. */
export const DEMO_FIELDS = Object.freeze([
  { id: "character.name", label: "Demo character name", type: "string" },
  { id: "character.portrait", label: "Demo portrait", type: "image" },
  { id: "character.tokenPortrait", label: "Demo token portrait", type: "image" },
  { id: "character.uuid", label: "Synthetic demo identifier", type: "string" },
  { id: "character.type", label: "Demo data source", type: "string" },
  { id: "character.hp.current", label: "Demo health", type: "number", maxField: "character.hp.max" },
  { id: "character.hp.max", label: "Demo maximum health", type: "number" },
  { id: "character.hp.percent", label: "Demo health percent", type: "number", format: "percent" },
  { id: "character.level", label: "Demo level", type: "number" },
  { id: "character.power.current", label: "Demo power", type: "number", maxField: "character.power.max" },
  { id: "character.power.max", label: "Demo maximum power", type: "number" },
  { id: "character.stress.current", label: "Demo stress", type: "number", maxField: "character.stress.max" },
  { id: "character.stress.max", label: "Demo maximum stress", type: "number" },
  { id: "character.psyche", label: "Demo psyche", type: "number" }
].map(Object.freeze));
const FIELD_IDS = new Set(DEMO_FIELDS.map(field => field.id));

/** In-memory scalar data. It never creates, resolves, reads, or updates Foundry documents. */
export class DemoDataSource {
  constructor() {
    this.health = new Map([[DEMO_ACTOR_UUIDS[0], 75], [DEMO_ACTOR_UUIDS[1], 40]]);
  }

  list() { return DEMO_CHARACTERS.map(character => ({ ...character })); }

  resolve(reference, fields = []) {
    if (!isDemoReference(reference)) throw new TypeError("Choose one of the bundled DEMO DATA characters.");
    const index = DEMO_ACTOR_UUIDS.indexOf(reference), character = DEMO_CHARACTERS[index];
    const hpMax = index === 0 ? 100 : 60;
    const all = {
      "character.name": character.name, "character.portrait": character.portrait,
      "character.tokenPortrait": character.portrait, "character.uuid": reference, "character.type": character.type,
      "character.hp.current": this.health.get(reference), "character.hp.max": hpMax,
      "character.hp.percent": this.health.get(reference) / hpMax * 100,
      "character.level": index === 0 ? 3 : 5,
      "character.power.current": index === 0 ? 4 : 7, "character.power.max": index === 0 ? 6 : 10,
      "character.stress.current": index === 0 ? 2 : 1, "character.stress.max": 5,
      "character.psyche": index === 0 ? 2 : 4
    };
    const requested = [...new Set(Array.isArray(fields) ? fields.slice(0, 128) : [])];
    const values = Object.fromEntries(requested.filter(field => FIELD_IDS.has(field)).map(field => [field, all[field]]));
    return { values, warning: requested.length === Object.keys(values).length ? null : "Some selected fields are not provided by DEMO DATA." };
  }

  simulate(reference, action) {
    if (!isDemoReference(reference)) throw new TypeError("Only synthetic DEMO DATA characters can be simulated.");
    if (!["damage", "healing"].includes(action)) throw new TypeError("Choose damage or healing for the demo simulation.");
    const maximum = reference === DEMO_ACTOR_UUIDS[0] ? 100 : 60;
    this.health.set(reference, Math.min(maximum, Math.max(0, this.health.get(reference) + (action === "damage" ? -10 : 10))));
    return true;
  }
}
