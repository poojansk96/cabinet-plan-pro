# Architecture rules
- Cabinet Takeoff unit extraction resolves shared-building labels inside the page-specific function helper; no cross-page number inference is permitted.
- Cabinet Takeoff review and import use the same building-plus-unit identity helper (floor excluded) so separate buildings never merge and a number repeated across floors stays one unit.