/** Synthetic data fixtures shaped like Cyberpunk RED Core 0.92.4 Actors. No real Actor or world data. */
const permission = (user, level) => user?.id === "viewer" && level === "OBSERVER";
const stats = values => Object.fromEntries(Object.entries(values).map(([id, value]) => [id, typeof value === "number" ? { value } : value]));

export function createCprCharacter() {
  return {
    id: "cprpc", uuid: "Actor.cprpc", documentName: "Actor", type: "character", name: "Synthetic solo",
    img: "assets/synthetic-portrait.webp", testUserPermission: permission,
    system: {
      derivedStats: { currentWoundState: "seriouslyWounded", deathSave: { basePenalty: 0, penalty: 1, value: 7 },
        hp: { max: 40, value: 18, transactions: [["PRIVATE ledger"]] }, humanity: { max: 52, value: 47, transactions: [] },
        run: { value: 18 }, seriouslyWounded: 20, walk: { value: 9 } },
      stats: stats({ int: 5, ref: 8, dex: 7, tech: 4, cool: 6, will: 6, luck: { value: 3, max: 6 }, move: 6, body: 7, emp: { value: 5, max: 6 } }),
      externalData: { currentArmorBody: { id: "kevlar", value: 9, max: 11 }, currentArmorHead: { id: "helmet", value: 11, max: 11 },
        currentArmorShield: { id: "", value: 0, max: 0 }, currentWeapon: { id: "pistol", value: 6, max: 8 } },
      roleInfo: { activeRole: "Solo", activeNetRole: "" },
      reputation: { value: 3, transactions: [] },
      wealth: { value: 1250, transactions: [["PRIVATE ledger"]] },
      information: { alias: "PRIVATE alias", notes: "PRIVATE notes" }
    }
  };
}

export function createCprMook() {
  const mook = createCprCharacter();
  Object.assign(mook, { id: "cprmook", uuid: "Actor.cprmook", type: "mook", name: "Synthetic booster" });
  delete mook.system.wealth;
  mook.system.derivedStats.currentWoundState = "lightlyWounded";
  mook.system.roleInfo.activeRole = "";
  return mook;
}
