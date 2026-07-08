## Summary

<!-- One paragraph: what this PR does and why. -->

Closes #<issue-number>

## Acceptance criteria mapping

<!-- One row per Acceptance Criterion from the issue. Every AC must map to where it is
     satisfied (file/test). A PR that cannot fill this table is not ready. -->

| Acceptance criterion | Satisfied by |
|----------------------|--------------|
|                      |              |

## Checklist

- [ ] Local gate green: `npm run check` (build, tests, lint, format)
- [ ] No career-specific literals in engine code; player-visible text is a locale key
- [ ] New Systems use the System lifecycle and communicate only via the event bus / world state
- [ ] Determinism preserved: no wall-clock or unseeded randomness in simulation code
- [ ] Scope limited to the issue's Deliverables and Interface Contract
