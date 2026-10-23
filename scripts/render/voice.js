/**
 * Discord voice on one layer element: it glows while its person speaks and, if asked, appears
 * only while that person is in the channel or speaking. Classes and one color variable only;
 * renderer.css draws the glow, so the layer's own inline style stays untouched.
 */
import { ACCENT_FIELD } from "../data/bindings.js";

/** "#aa50ff" → "170, 80, 255" for rgba() in the stylesheet. */
export function rgbTriplet(color) {
  let hex = String(color ?? "").replace(/^#/, "");
  if (hex.length === 3 || hex.length === 4) hex = [...hex.slice(0, 3)].map(digit => digit + digit).join("");
  hex = hex.slice(0, 6);
  if (!/^[\da-f]{6}$/i.test(hex)) return "255, 255, 255";
  return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16)).join(", ");
}

/**
 * Returns null for layers without a voice target; `refresh` re-reads the character, `destroy`
 * detaches. With character data, a layer showing a character glows in that character's accent
 * (in CAIN its blasphemy's color) unless the layer or the player sets a color.
 */
export function bindVoice(element, layer, hub, getActor = () => "", characterData = null) {
  if (!hub || !layer.voiceTarget) return null;
  element.classList.add("mso-voice");
  if ((layer.voiceEffect ?? "glow") === "glow") element.classList.add("mso-voice-glow");
  const release = layer.voiceTarget === "user" ? hub.claim(layer.voiceUser) : null;
  let disposed = false, accentActor = null, accent = "", stopAccent = null, generation = 0;
  const watchAccent = actor => {
    if (actor === accentActor) return;
    accentActor = actor; accent = "";
    stopAccent?.(); stopAccent = null;
    if (!actor || layer.voiceColor || typeof characterData?.resolve !== "function") return;
    const current = ++generation;
    const load = async () => {
      try {
        const result = await characterData.resolve(actor, [ACCENT_FIELD]);
        if (disposed || current !== generation) return;
        accent = typeof result?.values?.[ACCENT_FIELD] === "string" ? result.values[ACCENT_FIELD] : "";
        apply();
      } catch { /* An unreadable character keeps the default glow. */ }
    };
    stopAccent = characterData.subscribe?.(actor, () => { void load(); }) ?? null;
    void load();
  };
  const apply = () => {
    if (disposed) return;
    const actor = getActor() ?? "";
    watchAccent(actor);
    const { present, speaking, color, ignoreShow } = hub.resolve(layer, actor, { accent });
    element.style.setProperty("--mso-voice-rgb", rgbTriplet(color));
    element.classList.toggle("mso-speaking", speaking);
    const show = layer.voiceShow ?? "always";
    element.classList.toggle("mso-voice-away", !ignoreShow && (show === "present" ? !present : show === "speaking" ? !speaking : false));
  };
  const unsubscribe = hub.subscribe(apply);
  apply();
  return {
    refresh: apply,
    destroy() { disposed = true; unsubscribe(); release?.(); stopAccent?.(); }
  };
}
