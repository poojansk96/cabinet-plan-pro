# Architecture rules
- Cabinet Takeoff unit extraction resolves shared-building labels inside the page-specific function helper; no cross-page number inference is permitted.
- Cabinet Takeoff review and import use the same building-plus-floor-plus-unit identity helper so neither separate buildings nor separately drawn floors overwrite each other's units.