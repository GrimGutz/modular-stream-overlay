import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createOverlay } from "../scripts/core/schema.js";
import { WidgetRegistry } from "../scripts/core/registry.js";
import { OverlayRenderer } from "../scripts/render/renderer.js";

class Element {
  constructor(tag) {
    this.tagName = tag; this.style = {}; this.children = []; this.dataset = {}; this.attributes = {};
    this.classList = { add() {} }; this.listeners = new Map();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  getBoundingClientRect() { return { width: 960, height: 540 }; }
}

beforeEach(() => {
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.ResizeObserver = class {
    observe() {} disconnect() { this.disconnected = true; }
  };
});

function fixture(widgets = new WidgetRegistry()) {
  const container = new Element("main");
  const renderer = new OverlayRenderer(container, { widgets, resolveAsset: src => `/prefix/${src}` });
  return { container, renderer, overlay: createOverlay() };
}

test("background uses referenced assets, alpha, scaling and logical canvas dimensions", async () => {
  const { container, renderer, overlay } = fixture();
  overlay.background = { src: "assets/frame.webp", opacity: 0.4, fit: "stretch" };
  await renderer.render(overlay);
  const stage = container.children[0];
  assert.equal(stage.style.width, "1920px");
  assert.equal(stage.style.height, "1080px");
  assert.equal(stage.style.transform, "scale(0.5)");
  assert.equal(stage.children[0].src, "/prefix/assets/frame.webp");
  assert.equal(stage.children[0].style.opacity, "0.4");
  assert.equal(stage.children[0].style.objectFit, "fill");
  renderer.destroy();
});

test("transparent overlay contains no opaque elements and removing background clears the image", async () => {
  const { renderer, overlay } = fixture();
  overlay.background.src = "assets/frame.png";
  await renderer.render(overlay);
  overlay.background.src = "";
  await renderer.render(overlay);
  assert.equal(renderer.root.children.length, 0);
  renderer.destroy();
});

test("image failures are hidden without injecting error text into broadcast", async () => {
  const { renderer, overlay } = fixture();
  overlay.background.src = "assets/missing.png";
  await renderer.render(overlay);
  const image = renderer.root.children[0];
  image.listeners.get("error")();
  assert.equal(image.style.visibility, "hidden");
  renderer.destroy();
});

test("layers and widgets honor visibility and cross-type stack order", async () => {
  const widgets = new WidgetRegistry();
  widgets.register({ id: "sample:text", label: "Text", render({ element }) { element.textContent = "Public"; } });
  const { renderer, overlay } = fixture(widgets);
  overlay.layers = [{ id: "top", type: "color", color: "#ff0000", z: 4 }, { id: "hidden", type: "image", visible: false }];
  overlay.widgets = [{ id: "text", type: "sample:text", z: 2 }];
  await renderer.render(overlay);
  assert.deepEqual(renderer.root.children.filter(child => child.style.visibility !== "hidden").map(child => child.dataset.instanceId), ["text", "top"]);
  assert.equal(renderer.layerElements.get("hidden").style.visibility, "hidden", "Hidden targets stay addressable to Show rules");
  assert.equal(renderer.layerElements.get("top").style.backgroundColor, "#ff0000");
  renderer.destroy();
});

test("unknown widgets are retained without crashing renderer", async () => {
  const { renderer, overlay } = fixture();
  overlay.widgets = [{ id: "unknown", type: "absent:widget", config: { text: "Public" } }];
  await renderer.render(overlay);
  assert.equal(renderer.root.children.length, 1);
  assert.equal(renderer.root.children[0].children.length, 0);
  renderer.destroy();
});

test("widget receives isolated configuration and lifecycle cleanup", async () => {
  let args, data, cleaned = 0;
  const widgets = new WidgetRegistry();
  widgets.register({ id: "sample:one", label: "One",
    render(value) { args = value; value.config.text = "Changed"; },
    update(value) { data = value.data; },
    destroy() { cleaned++; }
  });
  const { renderer, overlay } = fixture(widgets);
  overlay.widgets = [{ id: "one", type: "sample:one", config: { text: "Original" } }];
  await renderer.render(overlay);
  assert.equal(overlay.widgets[0].config.text, "Original");
  assert.equal(args.context.mode, "broadcast");
  await renderer.update({ name: "Public character" });
  assert.deepEqual(data, { name: "Public character" });
  await renderer.render(null);
  assert.equal(cleaned, 1);
  renderer.destroy();
  assert.equal(cleaned, 1);
});

test("late asynchronous widget renders cannot replace newer overlay or restore cleared output", async () => {
  let finish;
  let cleaned = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const widgets = new WidgetRegistry();
  widgets.register({ id: "sample:slow", label: "Slow", render: () => pending, destroy() { cleaned++; } });
  const { renderer, container, overlay } = fixture(widgets);
  overlay.widgets = [{ id: "slow", type: "sample:slow" }];
  const old = renderer.render(overlay);
  await renderer.render(null);
  finish();
  await old;
  assert.equal(container.children.length, 0);
  assert.equal(cleaned, 1);
  renderer.destroy();
});

test("destroy invalidates pending render and disconnects resize listener", async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const widgets = new WidgetRegistry();
  widgets.register({ id: "slow", label: "Slow", render: () => pending });
  const { renderer, container, overlay } = fixture(widgets);
  overlay.widgets = [{ id: "one", type: "slow" }];
  const render = renderer.render(overlay);
  renderer.destroy();
  finish(); await render;
  assert.equal(renderer.observer.disconnected, true);
  assert.equal(container.children.length, 0);
});

test("invalid configuration cannot be rendered or execute an image URL", async () => {
  const { renderer, container, overlay } = fixture();
  overlay.background.src = "javascript:alert(1)";
  await assert.rejects(renderer.render(overlay), /relative path/);
  assert.equal(container.children.length, 0);
  renderer.destroy();
});

test("text renders literally with typography, rotation and opacity in shared output", async () => {
  const { renderer, overlay } = fixture();
  overlay.layers = [{ id: "caption", type: "text", text: '<img src=x onerror=alert(1)>\nПривет 🌟',
    x: 960, y: 540, width: 500, height: 120, rotation: -30, opacity: .6,
    fontFamily: "Georgia", fontSize: 36, fontWeight: "700", color: "#12ab34cc", align: "right", shadow: true }];
  await renderer.render(overlay);
  const element = renderer.root.children[0], text = element.children[0];
  assert.equal(element.style.left, "960px");
  assert.equal(element.style.top, "540px");
  assert.equal(element.style.transform, "rotate(-30deg)");
  assert.equal(element.style.opacity, "0.6");
  assert.equal(text.textContent, overlay.layers[0].text);
  assert.equal(text.children.length, 0, "Text never creates HTML elements");
  assert.equal(text.style.fontFamily, '"Georgia", serif');
  assert.equal(text.style.fontSize, "36px");
  assert.equal(text.style.fontWeight, "700");
  assert.equal(text.style.color, "#12ab34cc");
  assert.equal(text.style.textAlign, "right");
  assert.notEqual(text.style.textShadow, "none");
  assert.equal(element.children.length, 1, "Shared output contains content only");
  renderer.destroy();
});

test("gesture geometry patches preserve stage, image and widget lifecycle at fixed preview scale", async () => {
  const { renderer, overlay } = fixture();
  overlay.layers = [{ id: "image", type: "image", src: "assets/frame.png", width: 640, height: 360 }];
  renderer.setScale(2);
  await renderer.render(overlay);
  const stage = renderer.root, element = stage.children[0], image = element.children[0];
  renderer.updateLayer({ ...renderer.overlay.layers[0], x: 100, y: 90, width: 800, rotation: 15 });
  assert.equal(renderer.root, stage);
  assert.equal(stage.children[0], element);
  assert.equal(element.children[0], image);
  assert.equal(element.style.left, "100px");
  assert.equal(element.style.width, "800px");
  assert.equal(element.style.transform, "rotate(15deg)");
  assert.equal(stage.style.transform, "scale(2)");
  assert.equal(renderer.overlay.layers[0].y, 90);
  assert.equal(overlay.layers[0].x, undefined, "Renderer cannot mutate the saved input");
  renderer.setScale(null);
  assert.equal(stage.style.transform, "scale(0.5)");
  renderer.destroy();
});

test("registered future layers share widget rendering and hidden text stays invisible", async () => {
  let mode, cleaned = 0;
  const widgets = new WidgetRegistry();
  widgets.register({ id: "sample:label", label: "Custom label", defaults: { prefix: "Live" },
    render({ element, config, context }) { element.textContent = `${config.prefix}: ${config.text}`; mode = context.mode; },
    destroy() { cleaned++; }
  });
  const { renderer, overlay } = fixture(widgets);
  overlay.layers = [
    { id: "future", type: "sample:label", config: { text: "Public" }, z: 2 },
    { id: "hidden-caption", type: "text", text: "Private", visible: false, z: 3 }
  ];
  await renderer.render(overlay);
  assert.equal(renderer.root.children.filter(child => child.style.visibility !== "hidden").length, 1);
  assert.equal(renderer.root.children[0].textContent, "Live: Public");
  assert.equal(mode, "broadcast");
  assert.equal(renderer.layerElements.get("hidden-caption").style.visibility, "hidden");
  renderer.destroy();
  assert.equal(cleaned, 1);
});
