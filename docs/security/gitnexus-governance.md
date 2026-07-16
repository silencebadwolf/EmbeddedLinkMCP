# GitNexus Change Governance

The repository versions `.gitnexusrc` with `pdg: true`. Before editing an existing function, class, or method, verify that the index commit matches HEAD and run upstream impact for the exact symbol. Report HIGH or CRITICAL risk, direct dependents, affected processes, and affected modules before editing.

Use GitNexus query/context to understand execution flows before broad text search. Do not rename symbols with text replacement; use graph-aware rename.

PDG and persisted taint are directed supporting evidence. Zero findings are not proof of safety: callback/closure flows, fields/properties, implicit control flow, sanitizers, context merging, and other model limits still require targeted tests and trust-boundary review.

Before claiming a Phase complete, run `detect_changes` against `main`, inspect every changed symbol and affected process, and cross-check untracked/new files with exact `git status` and diff scope. The phase also needs fresh OpenSpec, lint, build, full test, license, coverage-report, review, and no-product-behavior-change evidence.

Phase 0 does not call GitNexus from product runtime or CI, and GitNexus is never an authorization authority.
