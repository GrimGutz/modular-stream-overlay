# Interface languages

Open **Game Settings → Configure Settings → Modular Stream Overlay → Interface Language / Язык интерфейса**. Choose **Auto / Автоматически** (default), **English**, or **Русский**. The preference uses Foundry's `client` setting scope, so each browser/client can choose independently. It survives a reload. Changing it updates open module configuration windows in place; no reload is required.

Auto reads the public `game.i18n.lang` property. Russian regional variants such as `ru-RU` use Russian; English and all unsupported languages fall back to English. The module never calls `game.i18n.setLanguage` or changes `core.language`.

Only configuration UI is translated. Overlay names, text, Actor names, user field labels, preset IDs, asset paths, OBS URLs and rendered stream labels remain unchanged. Language changes do not save drafts, rebuild previews, restart carousels, or send stream commands. Foundry window chrome and native file pickers follow Foundry's own language; third-party provider labels remain as supplied.

## Adding interface text

1. Add the same key under `modular-stream-overlay` in **both** `lang/en.json` and `lang/ru.json`. Keep the same `{parameter}` names in each language. Use descriptive sections such as `Editor`, `Widgets`, `Animations`, `Template`, or `Settings`.
2. In JavaScript import `t`, `setText`, or `setAttr` from `scripts/ui/i18n.js`. `t("Editor.Title")` resolves the module preference independently of Foundry. `t("Widgets.DeletePagePrompt", {name: page.name})` substitutes parameters without translating user values. Use `textContent`, not HTML interpolation, for user values.
3. For captions that remain mounted, use `setText(caption, "Editor.Title")` and `setAttr(button, "title", "Editor.Title")`. Mark a dedicated text-only span if a label also contains an input. These helpers preserve nested controls, focus and unsaved values when the language changes.
4. Templates use `{{msoT "Template.Overlays"}}` and `data-i18n="Template.Overlays"` on text-only elements. For attributes use `data-i18n-title`, `data-i18n-aria-label`, `data-i18n-placeholder`, or `data-i18n-alt`. Parameterized template captions also declare `data-i18n-param-name="{{name}}"` and pass `name=name` to `msoT`.
5. Translate known schema labels using `uiText(englishLiteral)` only at configuration boundaries. Use `setUIText` / `setUIAttr` for persistent schema captions. Never run these over user content or renderer DOM. Built-in field labels may be translated; mappings and external provider labels must remain intact.
6. Keep validators and engine errors language-neutral. Add their English message (or `{label}` template) and Russian equivalent under `Validation`, then show `errorText(error)` in configuration UI. Unknown external errors remain unchanged. Missing Russian keys fall back to English.

`onLanguageChange` is for lightweight caption updates only. Do not call application `render()`, refresh saved settings, replace drafts, or refresh an output renderer from this hook. Use explicit markers for dialogs as well as primary windows. The helper registers `msoT` during initialization and refreshes native module setting/menu captions without rebuilding their forms.

Run `npm run check` and `npm test`. Focused localization tests check language variants, both independent overrides, client persistence, dictionary/parameter parity, English fallback and preservation of controls. When testing Foundry, open an editor and widget designer with an unsaved input, change the interface language, and verify that the input node and renderer are unchanged. Do not publish or overwrite saved overlays to test translation.

Verified in TEST on Foundry 14.368: Auto with Russian Foundry, independent English and Russian selection, editor/widget/animation captions, native module settings captions, unsaved inputs/focus/draft maps, mounted previews, unchanged saved records, and client preference persistence across a reload. Both cross-language combinations, unsupported/regional languages, missing-key fallback and foreign translation-marker isolation are covered by automated tests. OBS rendering was not separately retested for this localization update. CAIN 1.3.26 also reports its existing `html.find` error from its application-render hook; this is outside the module and was left unchanged.
