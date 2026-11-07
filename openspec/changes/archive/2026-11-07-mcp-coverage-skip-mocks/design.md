## Decision

Skip by path in the scan's `walk`, not by name pattern: test and mock directories are where fake routes live, and a real handler never does. The optional `||=`, `??=` and computed-name registration forms are left out; none exist today.
