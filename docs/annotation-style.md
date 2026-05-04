# Annotation style guide

This file is the contract for the spec-annotation rewrite pass on `src/`.
The agent reads it at file boundaries during the independent Phase C
run. Revisions to the style happen here, not in chat.

## Reader

The annotations are written for someone with little prior JavaScript
and little prior SVG knowledge, who is in the codebase to find a bug.
One or two lookups per file are acceptable as long as the arc keeps the
reader oriented most of the time.

## Arc (reading order)

User-journey order. Anchors are written last, at the end of Phase C,
so all twelve resolve together.

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

`src/schema.generated.js`, `src/styles.css`, `index.html`, `scripts/`,
and `vendor/` are out of scope.

## File header (~10 lines)

Fixed shape, five sections:

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

No essay. The header ends at roughly ten lines.

## Per-block annotations (≤ 4 lines)

Hard cap of four lines per inline comment block.

- **Easy code → notes carry architecture.** When the code is short and
  obvious, use the comment to say *why this layer owns the call*, not
  what the call does.
- **Hard code → notes explain code.** When the code is intricate, the
  comment explains what is happening; architectural framing stays
  short or moves to the file header.
- **When both are heavy**, the prose density rises within the four-line
  cap. The density is the signal; the prose never announces "this is
  hard".

Don't paraphrase the code. The reader has the code right there.

## Voice and style

- Third person ("the editor", "the browser", "this layer"). Second
  person ("you") only in the file header, sparingly.
- Sentences over paragraphs.
- No emoji, no first person.
- Cite SVG vendor files inline by filename and section. Example:
  "the browser parses the same grammar as `paths.html` §8.3".
- **Browser-truth with SVG 2 educational asides.** When SVG 1.1
  differs from current browser behaviour, describe the browser, then
  add a short aside such as "(SVG 2 dropped this)" or "(SVG 2
  superseded `xlink:href` with `href`)" when it teaches something. The
  codebase will move to SVG 2 documentation later.
- Don't announce difficulty, don't announce structure, don't announce
  the next file. The arc anchors carry navigation; the prose carries
  content.

## Symptom → file map

Lives in `CLAUDE.md` at the repo root, not inside `src/`. Format:

```
| Symptom                                   | Start at                             | Why                              |
| ----------------------------------------- | ------------------------------------ | -------------------------------- |
| Drag moves the wrong attribute            | view/overlay.js → rules/grammars.js  | drag plan + grammar.translate    |
| Exported file looks different from canvas | io/file-io.js                        | default-equal omission, NS       |
| Insert menu missing a tag                 | rules/queries.js → main.js           | content-model filter             |
| Attribute clears unexpectedly             | doc/document.js                      | empty-string → removeAttribute   |
```

Written at the end of Phase C, when every file's role is fresh.

## REVIEW markers

Wherever a judgement call is made that the user would plausibly make
differently:

```
// REVIEW(annotation): <one-line concern>
```

Mark generously. The user is the bar — over-marking is correct,
under-marking is not.

## Phase plan

**A — calibration.** Three files, in this order:

1. `src/rules/grammars.js`
2. `src/view/overlay.js`
3. `src/main.js`

These three span the shape variety: data-and-spec, logic-and-cross-refs,
wiring. Arc anchors deferred.

**B — sign-off.** User reviews. This file is updated to capture any
new rulings. User signs off explicitly ("calibrated, continue") before
Phase C.

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
- `src/rules/index.js` (barrel — minimal annotation)

REVIEW markers are left wherever a call was uncertain. Arc anchors and
the `CLAUDE.md` symptom map are written at the end of this phase.

**C.5 — self-audit.** A single bounded pass over the Phase C diff. See
*Self-audit* below for the exact checks. Mechanical findings are fixed
in place; subjective findings become REVIEW markers. The audit does
not recurse — there is no audit-after-fix step.

**D — escalation.** A single message lists every REVIEW marker:
numbered, with file:line, choice made, alternative, and a one-sentence
reason. The user replies only on items they would change.

**E — cleanup.** The user's decisions are applied; every REVIEW marker
is removed; the branch is review-ready.

## Self-audit

A single-pass sweep run once at C.5, bounded explicitly to avoid
recursion: the audit runs once, mechanical findings are fixed in
place, subjective findings become REVIEW markers rather than
triggering another revision cycle.

**Mechanical checks** (grep over the Phase C diff; fix in place if the
fix is small):

- `this is hard`, `this is interesting`, `let me`, `we'll`, `I'll` —
  telling-not-showing or first-person leaks
- Comment blocks longer than four lines
- File headers longer than twelve lines
- Files missing the "Common bugs" section in the header
- Missing or malformed arc anchors
- Emoji in source

**Subjective checks** (one read-through; results become REVIEW markers,
not immediate revisions):

- Voice drift between earliest and latest Phase C files
- Per-block density that does not match the difficulty of the code
- SVG 1.1 / browser divergences without an SVG 2 aside where one would
  teach something

If a mechanical fix is non-trivial (more than ~10 lines of comment
churn), it is escalated as a REVIEW marker instead of fixed in place.

## Out of scope

- `src/schema.generated.js` — generated artefact
- `src/styles.css` — presentation
- `index.html` — markup
- `scripts/build-schema.mjs` — build tooling
- `vendor/REC-SVG11-20110816/` — source material
