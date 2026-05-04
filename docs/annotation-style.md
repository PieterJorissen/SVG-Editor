# Annotation style guide

This file is the contract for the spec-annotation pass on `src/`. It
lives on disk so it survives conversation compression. Revisions to
the style happen here, not in chat. The agent re-reads this file at
file boundaries during Phase C; sections at the top bear the heaviest
operational load.

## Reader

The annotations target someone with little prior JavaScript and little
prior SVG knowledge, in the codebase to find a bug. One or two lookups
per file are acceptable as long as the arc keeps the reader oriented.

## Arc (reading order)

User-journey order. Anchors are written last, at the end of Phase C.

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

## File header

Fixed five-section shape, ten-line target, fifteen-line hard limit:

```
// <role: one-line statement of what this file is>
//
// Inputs:  <one line — what calls in, what data flows in>
// Outputs: <one line — what this file emits or returns>
// Common bugs:
//   - <symptom>
//   - <symptom>
//
// prev: <file>  ·  next: <file>
```

Inputs and Outputs are sentences, not lists of names. Common bugs are
the breadcrumbs that point a troubleshooter to the right block below.

## Writing prose

### Length and density

There is no hard line cap on a per-block comment. Length matches
information density:

- One-line getters and mechanical helpers usually need no block.
- Easy code carrying architecture talk lands at four to seven lines.
- Hard code carrying code-explanation lands at five to nine lines;
  arc-defining functions can run longer.

The density is the signal — never announce difficulty.

### Story-first

Each block reads as a short paragraph that could appear in a manual
chapter, not as a flat list of facts each starting with "this". Every
sentence earns its lines: it introduces a fact about the layer,
explains why this layer owns the call, names a likely failure, or
hands off to what the browser does. Sentences that bridge, recap, or
rewrite a function body in English are removed.

Example shape:

```
// Bad — flat list:
//   This converts the delta to user space. This uses viewBox math.
//   This is needed because the browser scales the SVG.
//
// Good — paragraph:
//   Converts a client-pixel delta into a user-space delta. The
//   conversion uses viewBox-extent over rendered-extent on each
//   axis — the inverse of the browser's viewport-to-user mapping
//   in coords.html §7.10.
```

### Function-naming

Naming JavaScript functions inline is encouraged, not merely allowed.
Use a function name whenever the natural sentence reaches for it as
subject or object. Code is meaning-dense and the names *are* the
precise words English would otherwise have to invent. The fence is
taste: when every other sentence is naming a function, the prose has
slid into a code listing; otherwise let names anchor the paragraph.

Examples:

```
// Reach for the symbol when the sentence wants it:
//   the trailing `absoluteFirstM` check fixes the case up
//   `Document._onMutations` rebroadcasts the change
//   consumed by `buildDragPlan` in view/overlay.js
//   translate by the delta through `grammar.translate`
```

Naming a function and stating its role in one sentence is not
paraphrasing — it is the precise word English needs.

### Browser-truth, with SVG 2 asides

When SVG 1.1 differs from current browser behaviour, describe the
browser, then add a short aside when it teaches something. The
codebase will move to SVG 2 documentation later, so divergences are
educational rather than authoritative.

Example:

```
// the browser parses the same grammar (SVG 2 deprecated
// SVGPathSegList, so direct DOM access to segments is gone in
// modern engines) and rasterises each command per paths.html §8.3
```

### Padding fence

These markers are essay-creep tells. Remove the sentence or replace it
with the fact it was preparing.

```
Essentially          In other words           It's worth noting
Note that            This is important because
this is hard         this is interesting
let me               we'll                    I'll
```

First-person `I` / `we` in code comments is also forbidden.

### Voice

- Third person ("the editor", "the browser", "this layer"). Second
  person ("you") only in the file header, sparingly.
- Sentences over paragraphs; paragraphs over bullets, except inside
  the file header.
- No emoji.
- Don't announce difficulty, structure, or the next file. Arc anchors
  carry navigation; prose carries content.

## REVIEW markers and symptom map

REVIEW marker syntax — left wherever a judgement call could go either
way. Mark generously; the user is the bar.

```
// REVIEW(annotation): <one-line concern>
```

The symptom map lives in `CLAUDE.md` at the repo root, written at the
end of Phase C:

```
| Symptom                                   | Start at                             | Why                              |
| ----------------------------------------- | ------------------------------------ | -------------------------------- |
| Drag moves the wrong attribute            | view/overlay.js → rules/grammars.js  | drag plan + grammar.translate    |
| Exported file looks different from canvas | io/file-io.js                        | default-equal omission, NS       |
| Insert menu missing a tag                 | rules/queries.js → main.js           | content-model filter             |
| Attribute clears unexpectedly             | doc/document.js                      | empty-string → removeAttribute   |
```

## Process

**Phases.** A — calibration on `grammars.js`, `overlay.js`, `main.js`.
B — sign-off ("calibrated, continue"). C — independent batch over the
remaining nine files; arc anchors and the symptom map written at the
end. C.5 — single bounded self-audit. D — escalation message lists
every REVIEW marker. E — cleanup applies user decisions and removes
markers. No audit-after-fix step.

**Self-audit at C.5.** Mechanical checks grep the Phase C diff for the
padding markers above plus oversize file headers (>15 lines), missing
"Common bugs" sections, missing or malformed arc anchors, and emoji.
Small mechanical fixes are made in place; large ones become REVIEW
markers. Subjective checks: voice drift between files, blocks reading
as flat lists, block length not matching density, function-name
balance (over- or under-used), missing SVG 2 asides where one would
teach. Subjective findings become REVIEW markers, not autonomous
revisions.

## Out of scope

- `src/schema.generated.js` — generated artefact
- `src/styles.css` — presentation
- `index.html` — markup
- `scripts/build-schema.mjs` — build tooling
- `vendor/REC-SVG11-20110816/` — source material
