/**
 * Character widget instances in the overlay editor: assigned Actors, character profiles and
 * the per-instance carousel. Assignments stay on the instance, never on the reusable design.
 */
import { validateLayer } from "../core/schema.js";
import { safePortraitURL } from "../render/character-components.js";
import { DEMO_ACTOR_UUIDS } from "../demo/data.js";
import { PAGE_TRANSITIONS, resolveCarouselSettings } from "../carousel/schema.js";
import { t, setText, setAttr } from "./i18n.js";
import { L, S, labelText, editorError, writeText, writeAttr, writeError, setValidity, markDialog } from "./editor-text.js";

const { DialogV2 } = foundry.applications.api;

export const CharacterPanels = Base => class extends Base {
  async _chooseActor() {
    if (!this.characterData) throw new Error(t("Editor.CharacterDataNotReady"));
    // DialogV2 accepts an attribute-free DIV, serializes its children, then rebuilds the form.
    const content = document.createElement("div");
    const picker = document.createElement("div"); picker.className = "mso-actor-picker";
    const search = document.createElement("input"); search.type = "search"; setAttr(search, "placeholder", "Editor.SearchCharacters"); setAttr(search, "aria-label", "Editor.SearchCharacters");
    const list = document.createElement("div"); list.className = "mso-actor-list"; list.setAttribute("role", "list");
    const label = document.createElement("label"); setText(label, "Editor.ActorUUIDFoundryLink");
    const reference = document.createElement("input"); reference.type = "text"; reference.name = "actorReference"; setAttr(reference, "placeholder", "Editor.ActorReferenceExample");
    label.append(reference);
    const help = document.createElement("p"); setText(help, "Editor.ChooseActorHelp");
    picker.append(search, list, label, help); content.append(picker);
    const entries = this.characterData.listActors?.() ?? this.characterData.accessibleActors?.() ?? [];
    const actors = await Promise.resolve(entries);
    const result = await DialogV2.input({ window: { title: t("Editor.AssignCharacter") }, content, modal: true, rejectClose: false,
      render: (_event, dialog) => {
        markDialog(dialog, L("Editor.AssignCharacter"));
        const root = dialog.element.querySelector(".mso-actor-picker");
        const search = root.querySelector('input[type="search"]');
        const list = root.querySelector(".mso-actor-list");
        const reference = root.querySelector('[name="actorReference"]');
        const draw = () => {
          list.replaceChildren();
          for (const actor of actors.filter(entry => String(entry.name).toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))) {
            const button = document.createElement("button"); button.type = "button"; button.className = "mso-actor-choice"; button.setAttribute("role", "listitem");
            const image = document.createElement("img"); image.alt = ""; image.src = safePortraitURL(actor.img ?? actor.portrait ?? "", path => foundry.utils.getRoute(path));
            const name = document.createElement("span"); name.textContent = actor.name;
            button.append(image, name);
            button.addEventListener("click", () => { reference.value = actor.uuid; reference.focus(); });
            list.append(button);
          }
          if (!list.children.length) { const empty = document.createElement("p"); setText(empty, "Editor.NoMatchingActors"); list.append(empty); }
        };
        search.addEventListener("input", draw); draw();
      }
    });
    if (!result) return undefined;
    if (!result.actorReference?.trim()) return null;
    return this.characterData.resolveActor(result.actorReference.trim());
  }

  async _assignActor(reference) {
    const layer = this._selectedLayer();
    if (!layer || layer.type !== "character-widget") return;
    const draft = this._draft;
    const actor = reference === undefined ? await this._chooseActor() : reference ? await this.characterData.resolveActor(reference) : null;
    if (actor === undefined) return;
    if (this._draft !== draft || !this._allLayers().includes(layer)) return;
    if (actor && layer.dataSource === "demo") this._changeCharacterDataSource(layer, "actors");
    const remaining = this._assignedCharacters(layer).slice(1);
    this._setCarouselCharacters(layer, actor ? [actor.uuid, ...remaining.filter(uuid => uuid !== actor.uuid)] : []);
    await this._updatePreview(); this._renderLayerProperties();
  }

  async _dropActor(event) {
    const id = event.target.closest?.("[data-layer-id]")?.dataset.layerId;
    if (this._editingLayers().some(layer => layer.id === id && layer.type === "character-widget")) this._selectLayer(id);
    const layer = this._selectedLayer();
    if (!layer || layer.type !== "character-widget" || this._busy || this._uploading) return;
    event.preventDefault(); event.stopPropagation();
    await this._draftOperation(async () => {
      const implementation = foundry.applications.ux?.TextEditor?.implementation;
      const data = implementation?.getDragEventData(event) ?? {};
      if (data.type !== "Actor" || !data.uuid) throw new Error(t("Editor.DragActor"));
      if (event.target.closest?.("[data-assigned-characters]")?.dataset.assignedCharacters !== undefined) await this._addCarouselActor(data.uuid);
      else await this._assignActor(data.uuid);
    });
  }

  /** GM-only per-character values shared by every widget showing that Actor. */
  async _editCharacterProfiles(layer) {
    const api = this.api;
    if (!api?.setCharacterProfiles) throw new Error(t("Editor.CharacterDataNotReady"));
    const actors = this._assignedCharacters(layer).filter(uuid => /^Actor\./.test(uuid));
    if (!actors.length) throw editorError("Editor.ProfilesNoCharacters");
    const names = new Map((this.characterData?.listActors?.() ?? []).map(actor => [actor.uuid, actor.name]));
    const profiles = api.getCharacterProfiles();
    const content = document.createElement("div");
    const root = document.createElement("div"); root.className = "mso-profile-editor";
    const help = document.createElement("p"); setText(help, "Editor.ProfilesHelp"); root.append(help);
    actors.forEach((uuid, index) => {
      const row = document.createElement("fieldset"); row.className = "mso-profile-row";
      const legend = document.createElement("legend"); legend.textContent = names.get(uuid) ?? uuid; row.append(legend);
      for (const [key, caption, placeholder] of [["accent", "Editor.ProfileAccent", "#f79646"], ["fullName", "Editor.ProfileFullName", ""], ["art", "Editor.ProfileArt", ""]]) {
        const label = document.createElement("label"); label.className = "mso-layer-field";
        const title = document.createElement("span"); setText(title, caption);
        const input = document.createElement("input"); input.type = "text"; input.name = `${key}-${index}`;
        input.value = profiles[uuid]?.[key] ?? ""; if (placeholder) input.placeholder = placeholder;
        input.maxLength = key === "art" ? 4096 : key === "accent" ? 9 : 200;
        label.append(title, input);
        if (key === "accent") { const swatch = document.createElement("input"); swatch.type = "color"; swatch.dataset.profileSwatch = String(index); label.append(swatch); }
        if (key === "art") { const browse = document.createElement("button"); browse.type = "button"; browse.dataset.profileBrowse = String(index); setText(browse, "Editor.BrowseExisting"); label.append(browse); }
        row.append(label);
      }
      root.append(row);
    });
    content.append(root);
    const result = await DialogV2.input({ window: { title: t("Editor.ProfilesTitle") }, content, modal: true, rejectClose: false,
      render: (_event, dialog) => {
        markDialog(dialog, L("Editor.ProfilesTitle"));
        dialog.element.querySelectorAll("[data-profile-swatch]").forEach(swatch => {
          const text = dialog.element.querySelector(`[name="accent-${swatch.dataset.profileSwatch}"]`);
          if (/^#[\da-f]{6}$/i.test(text.value)) swatch.value = text.value;
          swatch.addEventListener("input", () => { text.value = swatch.value; });
          text.addEventListener("input", () => { if (/^#[\da-f]{6}$/i.test(text.value)) swatch.value = text.value; });
        });
        dialog.element.querySelectorAll("[data-profile-browse]").forEach(button => button.addEventListener("click", () => {
          const input = dialog.element.querySelector(`[name="art-${button.dataset.profileBrowse}"]`);
          void new foundry.applications.apps.FilePicker.implementation({ type: "image", current: input.value, allowUpload: false,
            callback: path => { input.value = path; } }).render({ force: true });
        }));
      }
    });
    if (!result) return;
    const next = { ...profiles };
    actors.forEach((uuid, index) => {
      next[uuid] = { accent: result[`accent-${index}`] ?? "", fullName: result[`fullName-${index}`] ?? "", art: result[`art-${index}`] ?? "" };
    });
    await api.setCharacterProfiles(next);
    ui.notifications?.info(t("Editor.ProfilesSaved"));
  }

  _renderWidgetProperties(host, layer) {
    const preset = this.widgetPresets?.list().find(entry => entry.id === layer.presetId);
    const description = document.createElement("p"); description.className = "mso-help"; writeText(description, preset ? L("Editor.SharedDesign", { name: preset.name }) : L("Editor.SourcePresetMissing")); host.append(description);
    const sourceLabel = document.createElement("label"); sourceLabel.className = "mso-layer-field"; const sourceCaption = document.createElement("span"); setText(sourceCaption, "Editor.DataSource"); sourceLabel.append(sourceCaption);
    const source = document.createElement("select"); setAttr(source, "aria-label", "Editor.DataSource");
    for (const [value, text] of [["actors", L("Editor.FoundryActors")], ["demo", L("Editor.DemoCharacters")]]) { const option = document.createElement("option"); option.value = value; writeText(option, text); source.append(option); }
    source.value = layer.dataSource ?? "actors"; source.disabled = this._uploading;
    source.addEventListener("change", () => { void this._draftOperation(async () => { this._changeCharacterDataSource(layer, source.value); await this._updatePreview(); this._renderLayerProperties(); this._renderAnimationTestPanel(); }); });
    sourceLabel.append(source); host.append(sourceLabel);
    const demoMode = layer.dataSource === "demo";
    if (demoMode) { const note = document.createElement("p"); note.className = "mso-binding-warning mso-help"; setText(note, "Editor.DemoHelp"); host.append(note); }
    const actor = document.createElement("p"); actor.className = "mso-help"; actor.dataset.actorStatus = ""; actor.setAttribute("role", "status"); writeText(actor, layer.actorUuid || L("Editor.NoAssignedCharacter")); host.append(actor);
    if (layer.actorUuid && this.characterData) {
      const id = layer.id; const reference = layer.actorUuid;
      const updateStatus = () => {
        void this.characterData.resolve(reference, ["character.name"]).then(result => {
          if (this._selectedLayerId !== id || this._selectedLayer()?.actorUuid !== reference) return;
          if (result.warning) writeError(actor, result.warning);
          else { delete actor.dataset.editorError; writeText(actor, String(result.values?.["character.name"] ?? reference)); }
          actor.classList.toggle("mso-binding-warning", !!result.warning);
        }).catch(error => { writeError(actor, error); actor.classList.add("mso-binding-warning"); });
      };
      updateStatus();
      this._actorStatusUnsubscribe = this.characterData.subscribe?.(reference, updateStatus);
    }
    const actions = document.createElement("div"); actions.className = "mso-image-actions";
    for (const [label, operation] of [...(!demoMode ? [[L("Editor.ChangeCharacter"), () => this._assignActor()], [L("Editor.ClearCharacter"), () => this._assignActor("")], [L("Editor.CharacterProfiles"), () => this._editCharacterProfiles(layer)]] : []), [L("Editor.EditDesign"), () => this._openWidgetPreset(layer.presetId)]]) {
      const button = document.createElement("button"); button.type = "button"; writeText(button, label); button.disabled = this._uploading || label.key === "Editor.EditDesign" && !preset; button.addEventListener("click", () => { void this._draftOperation(operation); }); actions.append(button);
    }
    host.append(actions);
    const label = document.createElement("label"); label.className = "mso-layer-field"; setText(label, "Editor.ActorUUIDLink");
    const reference = document.createElement("input"); reference.type = "text"; reference.value = demoMode ? "" : layer.actorUuid; setAttr(reference, "aria-label", "Editor.ActorUUIDLink");
    const apply = document.createElement("button"); apply.type = "button"; setText(apply, "Editor.ApplyCharacterLink"); apply.addEventListener("click", () => { void this._draftOperation(() => this._assignActor(reference.value.trim())); }); label.append(reference, apply); if (!demoMode) host.append(label);
    this._renderInstanceCarousel(host, layer, preset);
  }

  _assignedCharacters(layer) { return layer.actorUuids ?? (layer.actorUuid ? [layer.actorUuid] : []); }

  _changeCharacterDataSource(layer, source) {
    if (!this._allLayers().includes(layer) || !["actors", "demo"].includes(source) || (layer.dataSource ?? "actors") === source) return;
    if ((layer.dataSource ?? "actors") === "actors") this._realActorAssignments.set(layer.id, [...this._assignedCharacters(layer)]);
    const actors = source === "demo" ? [...DEMO_ACTOR_UUIDS] : [...(this._realActorAssignments.get(layer.id) ?? [])];
    Object.assign(layer, validateLayer({ ...layer, dataSource: source, actorUuid: actors[0] ?? "", actorUuids: actors, carousel: { ...layer.carousel, actorStartUuid: null } }, this._draft.canvas));
    this._markDirty();
  }

  async _replaceCarouselActor(layer, previous) {
    const draft = this._draft, actor = await this._chooseActor();
    if (!actor || draft !== this._draft || !this._allLayers().includes(layer)) return;
    const actors = [...this._assignedCharacters(layer)], index = actors.indexOf(previous);
    if (index < 0) return;
    if (actors.includes(actor.uuid) && actor.uuid !== previous) throw new Error(t("Editor.AlreadyAssigned"));
    actors[index] = actor.uuid; this._setCarouselCharacters(layer, actors);
    await this._updatePreview(); this._renderLayerProperties();
  }

  async _previewAssignedActor(layer, uuid) {
    const accepted = await this._preview?.renderer?.handleAnimationCommand?.({ overlayId: this._draft.id, layerId: layer.id, kind: "carousel", action: "select-actor", actorUuid: uuid });
    if (!accepted) throw new Error(t("Editor.ActorUnavailablePreview"));
    this._syncInstanceCarouselPreview();
  }

  async _addCarouselActor(reference) {
    const layer = this._selectedLayer(), draft = this._draft;
    if (!layer || layer.type !== "character-widget") return;
    const actor = reference === undefined ? await this._chooseActor() : await this.characterData.resolveActor(reference);
    if (!actor || this._draft !== draft || !this._allLayers().includes(layer)) return;
    if (layer.dataSource === "demo") this._changeCharacterDataSource(layer, "actors");
    const actors = [...this._assignedCharacters(layer)];
    if (actors.includes(actor.uuid)) return;
    if (actors.length >= 20) throw new Error(t("Editor.ActorLimit"));
    actors.push(actor.uuid);
    this._setCarouselCharacters(layer, actors);
    await this._updatePreview(); this._renderLayerProperties();
  }

  _setCarouselCharacters(layer, actors) {
    const carousel = { ...(layer.carousel ?? {}) };
    if (carousel.actorStartUuid && !actors.includes(carousel.actorStartUuid)) carousel.actorStartUuid = null;
    Object.assign(layer, validateLayer({ ...layer, actorUuid: actors[0] ?? "", actorUuids: actors, carousel }, this._draft.canvas));
    this._markDirty();
  }

  async _carouselCharacterCommand(layer, uuid, command) {
    if (!this._allLayers().includes(layer)) return;
    const actors = [...this._assignedCharacters(layer)], index = actors.indexOf(uuid);
    if (index < 0) return;
    if (command === "remove") actors.splice(index, 1);
    else {
      const next = index + (command === "up" ? -1 : 1);
      if (next < 0 || next >= actors.length) return;
      [actors[index], actors[next]] = [actors[next], actors[index]];
    }
    this._setCarouselCharacters(layer, actors);
    await this._updatePreview(); this._renderLayerProperties();
  }

  _instanceCarouselField(host, layer, label, field, { options, pageId, min, max, step } = {}) {
    const wrapper = document.createElement("label"); wrapper.className = "mso-layer-field";
    const title = document.createElement("span"); writeText(title, label);
    const input = document.createElement(options ? "select" : "input");
    input.dataset.instanceCarouselField = field; writeAttr(input, "aria-label", label);
    if (pageId) input.dataset.carouselPageId = pageId;
    if (!options) { input.type = "number"; setAttr(input, "placeholder", "Editor.PresetDefault"); }
    for (const option of options ?? []) { const entry = document.createElement("option"); entry.value = String(option.value); writeText(entry, option.label); input.append(entry); }
    for (const [key, value] of Object.entries({ min, max, step })) if (value !== undefined) input[key] = String(value);
    let value = pageId ? layer.carousel?.pageDurations?.[pageId] : layer.carousel?.[field];
    if ((field === "duration" || pageId) && value !== undefined && value !== null) value /= 1000;
    input.value = String(value ?? "");
    const key = `carousel.${layer.id}.${pageId ? `page.${pageId}` : field}`;
    if (this._invalidInputs.has(key)) { input.value = this._invalidInputs.get(key); setValidity(input, L("Editor.CorrectCarousel")); }
    input.disabled = this._uploading;
    input.addEventListener(options ? "change" : "input", () => this._onInstanceCarouselInput(input, layer, { field, pageId }));
    wrapper.append(title, input); host.append(wrapper); return input;
  }

  _onInstanceCarouselInput(input, layer, { field, pageId }) {
    if (this._busy || this._uploading || !this._allLayers().includes(layer)) return;
    const key = `carousel.${layer.id}.${pageId ? `page.${pageId}` : field}`;
    try {
      let value = input.value.trim() === "" ? null : input.value;
      if (["duration", "transitionDuration", "characterTransitionDuration"].includes(field) || pageId) {
        if (value !== null) value = Number(value) * (field === "duration" || pageId ? 1000 : 1);
        const isDuration = field === "duration" || !!pageId;
        if (value !== null && (!Number.isSafeInteger(value) || value < (isDuration ? 100 : 0) || value > (isDuration ? 3600000 : 10000))) throw editorError(isDuration ? "Editor.DwellRange" : "Editor.TransitionRange");
      }
      if (["loop", "enabled"].includes(field) && value !== null) value = value === "true";
      const carousel = { ...(layer.carousel ?? {}) };
      if (pageId) {
        carousel.pageDurations = { ...(carousel.pageDurations ?? {}) };
        if (value === null) delete carousel.pageDurations[pageId]; else carousel.pageDurations[pageId] = value;
      } else carousel[field] = value;
      Object.assign(layer, validateLayer({ ...layer, carousel }, this._draft.canvas));
      setValidity(input, ""); this._invalidInputs.delete(key); this._markDirty();
      void this._updatePreview().then(() => { if (["mode", "actorStartUuid", "startPageId"].includes(field)) this._renderLayerProperties(); });
    } catch (error) {
      setValidity(input, error); this._invalidInputs.set(key, input.value); this._markDirty();
    }
  }

  async _instancePageOrder(layer, preset, pageId, direction) {
    const order = this._orderedCarouselPages(layer, preset).map(page => page.id), index = order.indexOf(pageId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    Object.assign(layer, validateLayer({ ...layer, carousel: { ...layer.carousel, pageOrder: order } }, this._draft.canvas));
    this._markDirty(); await this._updatePreview(); this._renderLayerProperties();
  }

  _orderedCarouselPages(layer, preset) {
    const pages = preset?.pages ?? [], order = layer.carousel?.pageOrder ?? [];
    return [...order.map(id => pages.find(page => page.id === id)).filter(Boolean), ...pages.filter(page => !order.includes(page.id))];
  }

  _carouselPreviewSequence(layer, preset) {
    const { settings } = resolveCarouselSettings(layer, preset ?? {});
    const actors = this._assignedCharacters(layer);
    const allPages = this._orderedCarouselPages(layer, preset).filter(page => page.enabled !== false);
    const pages = allPages.length ? allPages : (preset?.pages?.length ? [] : [{ id: null, name: t("Editor.SharedCard") }]);
    const firstActor = actors.includes(settings.actorStartUuid) ? settings.actorStartUuid : actors[0];
    const firstPage = pages.find(page => page.id === settings.startPageId) ?? pages[0];
    const actorIds = ["information", "static"].includes(settings.mode) ? (firstActor ? [firstActor] : []) : actors;
    const displayedPages = ["character", "static"].includes(settings.mode) ? (firstPage ? [firstPage] : []) : pages;
    return settings.traversal === "characters-first" ? displayedPages.flatMap(page => actorIds.map(actorUuid => ({ actorUuid, pageId: page.id }))) : actorIds.flatMap(actorUuid => displayedPages.map(page => ({ actorUuid, pageId: page.id })));
  }

  _renderInstanceCarousel(host, layer, preset) {
    const section = document.createElement("section"); section.className = "mso-instance-carousel"; setAttr(section, "aria-label", "Editor.CarouselSettings");
    const title = document.createElement("h4"); setText(title, "Editor.CarouselSettings"); section.append(title); host.append(section);
    const inherited = [{ value: "", label: L("Editor.PresetDefault") }];
    this._instanceCarouselField(section, layer, L("Editor.CyclingMode"), "mode", { options: [...inherited, { value: "static", label: L("Editor.StaticMode") }, { value: "information", label: L("Editor.InformationMode") }, { value: "character", label: L("Editor.CharacterMode") }, { value: "combined", label: L("Editor.CombinedMode") }] });
    this._instanceCarouselField(section, layer, L("Editor.AutomaticPlayback"), "enabled", { options: [...inherited, { value: "true", label: L("Editor.PlayAutomatically") }, { value: "false", label: L("Editor.StartPaused") }] });
    this._instanceCarouselField(section, layer, L("Editor.TraversalOrder"), "traversal", { options: [...inherited, { value: "pages-first", label: L("Editor.PagesFirst") }, { value: "characters-first", label: L("Editor.CharactersFirst") }] });
    const assignedTitle = document.createElement("h5"); setText(assignedTitle, "Editor.AssignedCharacters"); section.append(assignedTitle);
    const assigned = document.createElement("div"); assigned.className = "mso-carousel-assigned"; assigned.dataset.assignedCharacters = ""; setAttr(assigned, "aria-label", "Editor.AssignedDrop"); section.append(assigned);
    const characters = this._assignedCharacters(layer), labels = new Map(), actorNodes = [];
    const addButton = (parent, label, operation, disabled = false) => {
      const button = document.createElement("button"); button.type = "button"; writeText(button, label); button.disabled = this._uploading || disabled;
      button.addEventListener("click", () => { void this._draftOperation(operation); }); parent.append(button); return button;
    };
    if (!characters.length) { const empty = document.createElement("p"); empty.className = "mso-help"; setText(empty, "Editor.NoCharacters"); assigned.append(empty); }
    characters.forEach((uuid, index) => {
      const row = document.createElement("div"); row.className = "mso-carousel-order-row";
      const name = document.createElement("span"); setText(name, "Editor.CharacterLoading", { index: index + 1 }); actorNodes.push([uuid, name]); row.append(name);
      if (layer.dataSource !== "demo") addButton(row, L("Editor.SelectActorIndex", { index: index + 1 }), () => this._replaceCarouselActor(layer, uuid));
      addButton(row, L("Editor.PreviewCharacterIndex", { index: index + 1 }), () => this._previewAssignedActor(layer, uuid));
      addButton(row, L("Editor.EarlierCharacterIndex", { index: index + 1 }), () => this._carouselCharacterCommand(layer, uuid, "up"), index === 0);
      addButton(row, L("Editor.LaterCharacterIndex", { index: index + 1 }), () => this._carouselCharacterCommand(layer, uuid, "down"), index === characters.length - 1);
      addButton(row, L("Editor.RemoveCharacterIndex", { index: index + 1 }), () => this._carouselCharacterCommand(layer, uuid, "remove")); assigned.append(row);
    });
    if (layer.dataSource === "demo") addButton(assigned, L("Editor.RestoreDemoCharacters"), async () => { this._setCarouselCharacters(layer, [...DEMO_ACTOR_UUIDS]); await this._updatePreview(); this._renderLayerProperties(); }, DEMO_ACTOR_UUIDS.every(uuid => characters.includes(uuid)));
    else addButton(assigned, L("Editor.AddCharacter"), () => this._addCarouselActor(), characters.length >= 20);
    const initialActor = this._instanceCarouselField(section, layer, L("Editor.InitialActor"), "actorStartUuid", { options: [{ value: "", label: L("Editor.FirstCharacter") }, ...characters.map((uuid, index) => ({ value: uuid, label: L("Editor.CharacterIndex", { index: index + 1 }) }))] });
    const pagesTitle = document.createElement("h5"); setText(pagesTitle, "Editor.InformationPageOrder"); section.append(pagesTitle);
    const pages = this._orderedCarouselPages(layer, preset);
    if (layer.carousel?.pageOrder?.length) addButton(section, L("Editor.PresetPageOrder"), async () => {
      Object.assign(layer, validateLayer({ ...layer, carousel: { ...layer.carousel, pageOrder: [] } }, this._draft.canvas));
      this._markDirty(); await this._updatePreview(); this._renderLayerProperties();
    });
    if (!pages.length) { const shared = document.createElement("p"); shared.className = "mso-help"; setText(shared, "Editor.SharedCardHelp"); section.append(shared); }
    pages.forEach((page, index) => {
      const row = document.createElement("div"); row.className = "mso-carousel-page-row";
      const name = document.createElement("strong"); setText(name, page.enabled === false ? "Editor.DisabledPageName" : "Editor.PageName", { index: index + 1, name: page.name }); row.append(name);
      const buttons = document.createElement("div"); buttons.className = "mso-page-actions"; row.append(buttons);
      addButton(buttons, L("Editor.EarlierPageIndex", { index: index + 1 }), () => this._instancePageOrder(layer, preset, page.id, -1), index === 0);
      addButton(buttons, L("Editor.LaterPageIndex", { index: index + 1 }), () => this._instancePageOrder(layer, preset, page.id, 1), index === pages.length - 1);
      this._instanceCarouselField(row, layer, L("Editor.NamedPageDuration", { name: page.name }), "duration", { pageId: page.id, min: .1, max: 3600, step: .1 }); section.append(row);
    });
    this._instanceCarouselField(section, layer, L("Editor.InitialPage"), "startPageId", { options: [...inherited, ...pages.filter(page => page.enabled !== false).map(page => ({ value: page.id, label: page.name }))] });
    this._instanceCarouselField(section, layer, L("Editor.PageDuration"), "duration", { min: .1, max: 3600, step: .1 });
    const transitionOptions = [...inherited, ...PAGE_TRANSITIONS.map(entry => ({ value: entry.id, label: S(entry.label) }))];
    this._instanceCarouselField(section, layer, L("Editor.PageTransition"), "transition", { options: transitionOptions });
    this._instanceCarouselField(section, layer, L("Editor.PageTransitionDuration"), "transitionDuration", { min: 0, max: 10000, step: 1 });
    this._instanceCarouselField(section, layer, L("Editor.CharacterTransition"), "characterTransition", { options: transitionOptions });
    this._instanceCarouselField(section, layer, L("Editor.CharacterTransitionDuration"), "characterTransitionDuration", { min: 0, max: 10000, step: 1 });
    this._instanceCarouselField(section, layer, L("Editor.Loop"), "loop", { options: [...inherited, { value: "true", label: L("Editor.Loop") }, { value: "false", label: L("Editor.StopAtEnd") }] });
    const previewTitle = document.createElement("h5"); setText(previewTitle, "Editor.PreviewSequence"); section.append(previewTitle);
    const sequence = document.createElement("ol"); sequence.className = "mso-carousel-sequence"; setAttr(sequence, "aria-label", "Editor.PreviewSequence"); section.append(sequence);
    const status = document.createElement("p"); status.className = "mso-help"; status.setAttribute("role", "status"); section.append(status);
    const controls = document.createElement("div"); controls.className = "mso-page-actions"; section.append(controls);
    for (const [label, command] of [[L("Editor.PreviousStep"), "previous"], [L("Editor.NextStep"), "next"], [L("Editor.PausePreview"), "pause"], [L("Editor.ResumePreview"), "resume"], [L("Editor.ResetPreview"), "reset"]]) addButton(controls, label, () => this._instanceCarouselPreview(layer.id, command), !preset);
    const note = document.createElement("p"); note.className = "mso-help"; setText(note, "Editor.PreviewHelp"); section.append(note);
    this._carouselPanel = { layerId: layer.id, layer, preset, labels, sequence, status };
    this._syncInstanceCarouselPreview();
    this._animationTestPanel?.refreshDiagnostics?.();
    const generation = this._carouselLabelsGeneration;
    void Promise.all(characters.map(async (uuid, index) => {
      try { const result = await this.characterData?.resolve(uuid, ["character.name"]); return [uuid, result?.warning ? L("Editor.CharacterUnavailable", { index: index + 1 }) : result?.values?.["character.name"] == null ? L("Editor.CharacterIndex", { index: index + 1 }) : String(result.values["character.name"])]; }
      catch { return [uuid, L("Editor.CharacterUnavailable", { index: index + 1 })]; }
    })).then(entries => {
      if (generation !== this._carouselLabelsGeneration || this._selectedLayerId !== layer.id) return;
      for (const [uuid, label] of entries) labels.set(uuid, label);
      for (const [uuid, node] of actorNodes) writeText(node, labels.get(uuid));
      for (const option of initialActor.children) if (labels.has(option.value)) writeText(option, labels.get(option.value));
      this._syncInstanceCarouselPreview();
      this._animationTestPanel?.refreshDiagnostics?.();
    });
  }

  async _instanceCarouselPreview(id, command) {
    const carousel = this._preview?.renderer?.compositions?.get(id)?.carousel;
    await carousel?.[command]?.(); this._syncInstanceCarouselPreview();
  }

  _syncInstanceCarouselPreview() {
    const panel = this._carouselPanel;
    if (!panel || this._selectedLayerId !== panel.layerId) return;
    const state = this._preview?.renderer?.compositions?.get(panel.layerId)?.carousel?.getState?.();
    const sequence = state?.sequence ?? this._carouselPreviewSequence(panel.layer, panel.preset);
    panel.sequence.replaceChildren();
    for (const step of sequence) {
      const item = document.createElement("li");
      const actorIndex = this._assignedCharacters(panel.layer).indexOf(step.actorUuid);
      const name = labelText(panel.labels.get(step.actorUuid) ?? L("Editor.CharacterIndex", { index: actorIndex + 1 }));
      const page = panel.preset?.pages?.find(entry => entry.id === step.pageId);
      item.textContent = `${name} / ${page?.name ?? t("Editor.SharedCard")}`;
      if (step.actorUuid === state?.activeActorUuid && step.pageId === state?.activePageId) item.setAttribute("aria-current", "step");
      panel.sequence.append(item);
    }
    const activeName = labelText(panel.labels.get(state?.activeActorUuid)), activePage = panel.preset?.pages?.find(page => page.id === state?.activePageId)?.name;
    panel.status.textContent = !sequence.length ? t("Editor.NoPreviewSteps") : state ? t("Editor.PreviewStatus", { active: activeName ? `: ${activeName} / ${activePage ?? t("Editor.SharedCard")}` : "", state: state.paused ? t("Editor.Paused") : t("Editor.Running"), count: sequence.length }) : t("Editor.ConfiguredSteps", { count: sequence.length });
  }
};
