# Phase 2 manual acceptance

This is a test plan, not a record of passed Foundry or OBS runtime checks. Automated Node tests and an isolated browser harness can verify module logic and DOM behavior; neither establishes compatibility with a running Foundry world or OBS authentication/session behavior.

## Implementation verification — 2026-10-20

Version 0.2.0 was edited and checked directly in the canonical installed module. Foundry's configured `dataPath` and this module's manifest were confirmed. No user images, persistent storage, or world databases were changed by implementation work.

- `npm run check`: passed; manifest references, assets, relative imports, and syntax across 25 JavaScript files.
- `npm test`: 115 tests; 114 passed, 0 failed, 1 skipped because Windows did not permit creation of the symbolic-link/junction test fixture. Tests use isolated settings and DOM doubles, not a running world.
- The installed Foundry Handlebars package compiled the populated and empty editor templates in strict mode. Template escaping and editor action bindings passed focused checks.
- The optional browser harness was not exercised successfully: Chromium exited before opening, and the supplied in-app browser could not reach the local harness. Visual layout, actual browser pointer behavior, native Foundry lifecycle, uploads against a live server, and OBS parity remain unverified.

`tools/browser-smoke.mjs` is an optional development harness using the real editor template and module code with mocked Foundry settings. It requires Playwright and an installed Chromium separately; these are not module runtime dependencies. `MSO_PLAYWRIGHT_MODULE` can identify an existing Playwright package, `MSO_CHROMIUM_EXECUTABLE` can identify its browser, and `MSO_FOUNDRY_APP` can override the installed Foundry application folder used to resolve Handlebars. It does not replace the acceptance steps below.

Run source checks in the canonical installed folder:

```powershell
Set-Location -LiteralPath 'C:\Users\Lev\AppData\Local\FoundryVTT\Data\modules\modular-stream-overlay'
npm run check
npm test
```

Use a test world for acceptance and retain a normal Foundry user-data backup. Do not edit world databases, remove existing assets, or replace the installed module directory. Record the Foundry version/build, RPG system/version, enabled modules, GM browser, OBS version, test date, and results. Test with another system if available; static image/text layouts should not depend on any system-specific Actor fields.

## 1. Existing installation and saved layouts

1. Restart Foundry after the manifest change. Refresh the GM browser and OBS source once to load the new code.
2. Enable the existing **Modular Stream Overlay** module and open its settings editor as GM. Confirm existing overlays, background references, custom presets, and the viewer account remain available.
3. Open a schema-1 overlay or preset. A missing `layers` collection should appear empty; existing legacy image/color layers should retain their geometry, order, names, and images. Opening or previewing it alone must not write the world setting. Saving should preserve the composition in schema 2.
4. Confirm the two built-in presets remain available and cannot be renamed or deleted. Do not create unsupported settings in a real world to test failure handling; automated tests cover rejection without resetting saved data.

## 2. Canvas, selection, and zoom

1. Create a 1920 × 1080 overlay with a transparent background. Confirm the checkerboard keeps its aspect ratio when the editor window is resized and that the canvas fits the available space.
2. Add an image and a text layer. Select each on the canvas and in the Layers panel; selection and Properties must agree. Click empty canvas to clear the selection.
3. Move a layer at fit zoom, 50%, and 100% (or the available zoom controls). A movement of 100 native pixels should remain 100 pixels in Properties at every zoom. Zooming must not change saved geometry.
4. Resize the application to a typical desktop size, including about 1120 × 790 and a smaller window. Controls must remain reachable through scrolling without covering the canvas permanently.
5. Save and reopen the overlay. Resolution, geometry, selection-independent content, and layer order must be preserved.

## 3. Image upload and replacement

1. Upload PNG, JPEG, and WebP images into image layers using the same workflow as background uploads. Confirm successful references use `modules/modular-stream-overlay/storage/`, display in preview, and do not change OBS before **Save overlay**.
2. Browse an existing Foundry image and replace a selected image. Cancel a file chooser. Try an empty, invalid, unsupported, and over-25-MiB upload. Failed or cancelled choices must preserve the prior image and leave the editor usable.
3. Check Contain, Cover, and Stretch on a non-square image. Change opacity. Turn aspect-ratio lock on, resize with corner and side handles, and confirm the current box proportions remain stable. Turn it off and resize width and height independently.
4. Try a missing managed asset path in a test overlay. The missing image must not crash the editor, remove other layers, or prevent correcting the path.
5. Repeat a background upload. The thumbnail, background fit, opacity, Browse Existing, Remove Background, and save behavior must still work. Reload Foundry and OBS, then restart the server, to confirm saved references persist.

## 4. Dragging, resizing, and rotation

1. Drag each layer continuously. The preview and position fields must update without rebuilding the entire application on each pointer movement. Dragging should not select surrounding text or activate native image dragging.
2. Resize from each handle. Width and height must stay positive and within supported bounds. Resizing across the opposite edge should stop at the minimum rather than produce inverted geometry.
3. Set rotation to 30°, 90°, and −45° in Properties. Drag and resize again at multiple zoom levels; the handles must stay aligned and the opposite edge/corner must stay anchored as appropriate.
4. Release the mouse outside the canvas/editor, then return. There must be no stuck drag. Press Escape during a drag and confirm the layer returns to its starting geometry. Resize the application or change zoom between gestures and confirm the next gesture uses the new scale.
5. Lock a layer. Canvas dragging, resizing, and arrow nudging must leave it unchanged. Confirm it can still be selected from the list and unlocked. Hide it and confirm the final preview omits it while the layer remains manageable in the list.

## 5. Properties, text, and shortcuts

1. Edit name, x/y, width/height, rotation, opacity, visibility, and lock state. Fields and canvas must agree immediately. Clear a required number or enter an invalid value: the editor must indicate the invalid value and block persistence rather than save corrupt geometry.
2. Enter multiple lines of text, Unicode characters, and literal text such as `<img src=x onerror=alert(1)>`. It must appear literally, with no HTML element or script execution.
3. Check every offered font, size, weight, hexadecimal color, alignment, and shadow. Confirm text is clipped to its layer box and resizing changes the box rather than scaling the font. Use a font installed on both the GM machine and OBS when checking exact matching.
4. Click the canvas and press arrows: movement should be 1 native pixel, or 10 with Shift. Ctrl/Cmd+D should create a new layer with a distinct ID and select it. Delete and Backspace should delete the selected layer.
5. Repeat those keys while editing a text area, layer name, numeric field, select control, and contenteditable control if an extension uses one. Normal text/caret/form behavior must remain, with no layer deletion, duplicate, or movement.
6. Focus a different Foundry application. Layer shortcuts must not affect the overlay editor.

## 6. Layers and complete-layout presets

1. Add overlapping image and text layers. Rename them, toggle visibility/lock, and select them from the list. Move a layer up/down and send it to back/bring it to front; list order and actual stacking must agree. The background must stay behind every layer.
2. Duplicate each supported type. Check the duplicate's text/image properties, geometry, new ID, and independent edits. Delete a duplicate and confirm other layers remain unchanged.
3. Save the complete layout as a custom preset. Change the overlay, then load the preset. Canvas dimensions, background, every layer, order, opacity, rotation, text styles, and image references must reconstruct. Loading uses the existing **Load & save** behavior and immediately publishes if the target overlay is active.
4. Load the preset into another overlay. Its existing overlay ID/name should remain; the composition should match. Duplicate and rename custom presets, delete the duplicate, reload Foundry, and confirm the remaining custom preset persists.

## 7. OBS parity and persistence

1. Follow the README's dedicated Player-account login and Browser Source instructions. Use the editor's generated URLs and match the canvas width/height in OBS.
2. Put a colored/video source behind the Browser Source. Transparent areas must reveal it. The saved background, images, text, geometry, rotation, opacity, and order must match the editor composition. No selection borders, handles, checkerboard, layer list, properties, toolbar, or Foundry chat/UI may appear.
3. Make an unsaved drag, resize, text edit, image change, visibility change, and reorder. OBS must retain the saved composition until **Save overlay**. Save and confirm the update arrives without restarting OBS or copying files.
4. Switch active overlays while OBS remains running. Select **None — transparent**, then save an inactive overlay; output must remain transparent. Delete the active overlay; output must clear.
5. Change drafts or close the editor with unsaved edits; confirm discard prompts work. Choose **Reload saved** and confirm it restores the saved layout after confirmation. Reopen the editor, refresh OBS, and restart Foundry; saved compositions and assets must persist.
6. Open two GM editors, change and save from one, and confirm a dirty stale draft in the other is preserved with a conflict rather than silently overwritten. Avoid deliberately simultaneous writes: the Foundry setting API has no atomic cross-client compare-and-swap.

## 8. Authorization and reconnection regressions

1. Open the overlay URL as a different Player and as a GM. Only access guidance should appear; the selected dedicated Player is the authorized viewer.
2. Disable or revoke the selected viewer and confirm the overlay clears. Restore the viewer and refresh/re-authenticate as needed.
3. Disconnect/reconnect the OBS session. Stale output must clear on disconnect and authoritative settings must load after reconnection.
4. If this server uses a route prefix, repeat login, image loading, and live saves behind that prefix.

Record individual failures and reproduction steps before marking runtime acceptance complete. Preserve any images uploaded during testing unless the user explicitly chooses to remove them; discarding a draft intentionally does not delete an uploaded file.
