import { createDnd5e533Actor } from "./dnd5e-5.3.3.js";

/** Research fixture only: 6.0.6 has not passed live Foundry adapter acceptance. */
export function createDnd5e606ResearchActor() {
  const actor = createDnd5e533Actor();
  actor.system.attributes.ac = { value: 19, calcs: new Set(["armored"]), formulas: [{ formula: "10 + @abilities.dex.mod" }] };
  actor.system.attributes.hp.bloodied = 50;
  actor.effects = [{ type: "condition", system: { level: 2 }, statuses: new Set(["exhaustion"]) }];
  return actor;
}
