# Annotation style guide

This file is the contract for the spec-annotation pass on `src/`. The
contract lives on disk so it survives conversation compression. Every
file annotated in Phases A and C must follow this guide. Revisions to
the style happen here, not in chat.

## Reader

The annotations are written for someone who:

- knows neither JavaScript idioms nor SVG concepts,
- is in the codebase to find a bug,
- is willing to look up one or two things per file as long as the arc
  keeps them oriented most of the time.

Don't assume prior context. Don't gate-keep. Trust the arc to do its
job across files — each annotation only carries what is load-bearing
for *its* file, and lets later files take their turn.

## Arc (reading order)

User-journey order. Each file's header carries `prev:` and `next:`
anchors. Anchors are written last, at the end of Phase C, so all
twelve resolve together.

1. `src/main.js` — entrypoint, wires layers
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

`src/schema.generated.js`, `src/styles.css`, `index.html`, `scripts/`,
and `vendor/` are out of scope.

## File header

Each annotated file opens with a comment block of the following shape.
Length adapts to the file's complexity (see *Granularity rule* below) —
a simple file can have a four-line header, a complex one may run to
twelve. Keep the order fixed.

```
// <one-line statement of what this file is>
//
// What it owns:
//   <one or two lines>
// Where it sits:
//   <one line summarising what calls in / what it calls>
// Common bugs that surface here:
//   - <symptom>
//   - <symptom>
// Spec hooks (browser-side):
//   <chapter(s) the browser uses to operationalise this layer>
//
// prev: <file>  ·  next: <file>
```

The header is the most important part of the annotation. A reader who
opens a single file cold should know within ten lines what the file
does, what is around it, and why a bug led them here.

## Granularity rule

Adaptive, deliberately uneven across the codebase.

- **Easy code carries the architecture talk.** When a method is short
  and obvious (a one-line setter, a getter, a `dispose` that detaches
  listeners), do not paraphrase it. Use the surrounding block, if any,
  to say *why this layer owns the call* rather than *what the call does*.
- **Hard code carries the code-explanation.** When a method is intricate
  (path-data translation, viewBox-to-screen mapping, mutation observer
  rebroadcast), the block leans toward what the code is doing
  step-by-step, with the architectural framing kept short.
- **When both are heavy** (rare), the block lengthens to reflect the
  density. The extra length is itself the signal — the prose never
  announces difficulty. Lookups are an acceptable cost in this case;
  prefer adding lines over compressing the explanation past the point
  it can teach the reader.

The annotations are a manual, not a tour. They reflect the shape of
the code rather than describing it from outside.

## Voice and style

- Use third person ("the editor", "the browser", "this layer"). Use
  second person ("you") only in the file header, sparingly.
- Sentences over paragraphs; paragraphs over bullets, except inside the
  file header.
- No emoji.
- No first person ("I", "we") in code comments. PR descriptions are
  different.
- Cite SVG vendor files inline by filename and section, not as headings.
  Example: "the browser parses the same grammar as `paths.html` §8.3".
- **Browser-truth.** When SVG 1.1 differs from current browser
  behaviour, describe the browser. A brief "(SVG 2 dropped this)" aside
  is welcome when it teaches something; otherwise omit. We will move
  to SVG 2 documentation later, so divergences are educational rather
  than authoritative here.
- Don't announce difficulty. Don't announce structure
  ("First we ... then we ..."). Don't announce the next file. The arc
  anchors carry navigation; the prose carries content.
- Don't say "this is hard" or "this is interesting"; the prose density
  reflects it.

## Symptom → file map

Lives in `CLAUDE.md` at the repo root, not inside `src/`. Format:

```
| Symptom                                  | Start at                  | Why                              |
| ---------------------------------------- | ------------------------- | -------------------------------- |
| Drag moves the wrong attribute           | view/overlay.js → rules/grammars.js | drag plan + grammar.translate    |
| Exported file looks different from canvas | io/file-io.js             | default-equal omission, NS       |
| Insert menu missing a tag                | rules/queries.js → main.js | content-model filter + ancestor walk |
| Attribute clears unexpectedly            | doc/document.js           | empty-string → removeAttribute   |
| ...                                      | ...                       | ...                              |
```

The map is written at the end of Phase C, when every file's role is
fresh, and updated as files change.

## REVIEW markers

Wherever a judgement call is made that the user would plausibly make
differently, leave an inline marker on the line immediately above the
relevant prose:

```
// REVIEW(annotation): <one-line concern>
```

Mark generously. The user has stated explicitly that they are the bar.
Over-marking is correct; under-marking is not. A marker is cheap; an
unflagged drift is not.

Markers may also be left at the *file header* level for cross-file
concerns (voice drift, anchor mismatch, scope creep) — same syntax,
placed before the file header.

## Phase plan

**A — calibration.** Three files, written against this guide, in this
order:

1. `src/rules/grammars.js`
2. `src/view/overlay.js`
3. `src/main.js`

These three span the shape variety: data-and-spec, logic-and-cross-refs,
wiring. Arc anchors are deferred to the end of Phase C.

**B — sign-off.** User reviews. This file is updated to capture any
new rulings; if no rulings emerge, the file is unchanged. User signs
off explicitly ("calibrated, continue") before Phase C starts.

**C — independent batch.** Remaining nine files in one batch on the
same branch:

- `src/io/file-io.js`
- `src/view/canvas.js`
- `src/view/attr-panel.js`
- `src/view/tree-panel.js`
- `src/doc/document.js`
- `src/doc/edit-session.js`
- `src/widgets/index.js`
- `src/rules/queries.js`
- `src/rules/index.js` (barrel — minimal annotation, role only)

REVIEW markers are left wherever a call was uncertain. Anchors are
written across all twelve files at the end of this phase. The symptom
map is written into `CLAUDE.md` at the end of this phase.

**D — escalation.** A single message lists every REVIEW marker:
numbered, each entry showing file:line, the choice made, the
alternative, and a one-sentence reason. User replies only on items
they would change.

**E — cleanup.** User's decisions are applied, every REVIEW marker is
removed, and the branch is review-ready.

No self-audit step between C and D.

## Out of scope

- `src/schema.generated.js` — generated artefact
- `src/styles.css` — presentation
- `index.html` — markup
- `scripts/build-schema.mjs` — build tooling
- `vendor/REC-SVG11-20110816/` — source material

## Mitigating context drift during Phase C

The on-disk contract is the primary defence. Two further measures:

- **Pre-flight summary.** At the top of Phase C, the agent posts a
  short summary of the rules it is about to apply, paraphrased from
  this file. The user confirms or corrects before files are written.
- **Re-read at boundaries.** The agent reads this file at the start of
  each new file in Phase C, accepting the token cost as insurance.

If the agent notices voice drift between earlier Phase C files and
later ones, it flags this as a REVIEW item rather than silently
revising earlier work.
