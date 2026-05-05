# CLAUDE.md

Notes for future Claude sessions and troubleshooters.

## How to read this codebase

Source files in `src/` carry inline annotations written for someone
with little prior JavaScript or SVG knowledge. The annotation style
is contract-bound by `docs/annotation-style.md`. Files are linked in
arc order via `prev:` / `next:` anchors in each file header, so
reading them in sequence forms a tour of the editor:

1. `src/main.js` — entrypoint
2. `src/io/file-io.js` — load and export
3. `src/view/canvas.js` — mount the SVG viewport
4. `src/view/overlay.js` — selection and drag
5. `src/view/attr-panel.js` — per-element editor
6. `src/view/tree-panel.js` — document tree mirror
7. `src/doc/document.js` — live SVG DOM wrapper
8. `src/doc/edit-session.js` — preview/commit buffer
9. `src/widgets/index.js` — UI controls per value type
10. `src/rules/grammars.js` — parse / serialise / translate
11. `src/rules/queries.js` — schema lookups
12. `src/rules/index.js` — barrel

For drop-in reading, every file's header lists its role, inputs,
outputs, and common bugs.

## Spec

Annotations cite `vendor/REC-SVG11-20110816/` (the SVG 1.1
Recommendation) by filename and section. The schema in
`src/schema.generated.js` is generated from that vendor tree by
`scripts/build-schema.mjs`. SVG 2 deltas are folded into prose as
educational asides; the codebase will move to SVG 2 documentation
later.

## Symptom → file map

A starting-point index for "I see X, where do I look?". Each row
points to the first file that owns the relevant code path; follow
the cross-refs in that file's header to drill in.

| Symptom                                            | Start at                                  | Why                                                        |
| -------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Drag moves the wrong attribute                     | `view/overlay.js` → `rules/grammars.js`   | `buildDragPlan` + `grammar.translate`                       |
| Drag moves in the wrong direction                  | `rules/queries.js`                        | `isXAxis` / `isYAxis` attribute classification             |
| Drag does nothing on a `<g>` or other container    | `view/overlay.js`                         | `buildDragPlan` falls back to `transform` only when present |
| Outline misaligned with the selected shape         | `view/overlay.js`                         | viewBox-to-screen math in `_clientDeltaToSvg`              |
| Exported file looks different from canvas          | `io/file-io.js`                           | default-equal omission in `exportClone`                     |
| Load fails silently on a bad SVG                   | `io/file-io.js`                           | `parsererror` sentinel in `loadSvgFile`                     |
| `xlink:` attributes dropped on round-trip          | `io/file-io.js` → `doc/document.js` → `rules/queries.js` | namespace dispatch in `setAttribute` / `namespaceOf`     |
| Insert menu missing a tag                          | `rules/queries.js` → `main.js`            | `canHaveChild` content-model check + `pickInsertTarget`    |
| Insert menu shows tags that produce invalid SVG    | `rules/queries.js`                        | `elementsAcceptedBy` content-model categories              |
| Attribute clears unexpectedly when edited          | `doc/document.js`                         | empty-string in `setAttribute` triggers `removeAttribute`  |
| Tree panel doesn't refresh after a delete          | `doc/document.js` → `view/tree-panel.js`  | MutationObserver in `Document` + `change` subscription     |
| Clicking a tree row doesn't select                 | `view/tree-panel.js`                      | `data-mid` mapping in `_render` + click delegate           |
| Tag shown in wrong case in the tree                | `view/tree-panel.js` → `rules/queries.js` | `displayTagFor` / canonical `localName`                    |
| Attribute panel row missing for a known attribute  | `view/attr-panel.js` → `rules/queries.js` | `attributesOf` flattens the schema's group lists           |
| Wrong widget for an attribute                      | `view/attr-panel.js` → `widgets/index.js` | `getWidget` dispatch by VALUE_TYPE                          |
| Enum dropdown is empty                             | `widgets/index.js` → `rules/queries.js`   | `attrInfo.enumValues` missing on the schema row            |
| Colour swatch resets to black on edit              | `widgets/index.js`                        | `#rrggbb`-only validation in `colorInput`                   |
| Editor doesn't load / blank page                   | `main.js`                                 | element id drift between `index.html` and `main.js`        |
| File load doesn't replace state                    | `main.js` → `view/*` `dispose`            | `bootstrap` order: panels disposed before the Document     |
| Path drag breaks relative segments                 | `rules/grammars.js`                       | `translatePathData` shifts only absolute operands          |
| CSS unit lost after a drag (e.g. `10mm` → `15`)    | `rules/grammars.js`                       | `LENGTH.translate` preserves the unit suffix               |

## Out of scope for the annotation pass

- `src/schema.generated.js` — generated artefact
- `src/styles.css` — presentation
- `index.html` — markup
- `scripts/build-schema.mjs` — build tooling
- `vendor/REC-SVG11-20110816/` — source material

## Annotation policy

All annotation conventions (file-header shape, per-block prose rules,
padding fence, function-naming guidance, plain-English-over-jargon
rule, `we`-for-design-intent rule, browser-truth + SVG 2 asides) are
defined in `docs/annotation-style.md`. Revisions to the style happen
in that file, not here.
