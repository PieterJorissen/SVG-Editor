// rules/index.js is the barrel for the rules layer: it re-exports
// queries.js (schema lookups, namespaces, axis classification) and
// grammars.js (parse / serialise / translate per VALUE_TYPE) so
// callers can import either with one path.
//
// prev: src/rules/queries.js  ·  next: (end)

export * from './grammars.js';
export * from './queries.js';
