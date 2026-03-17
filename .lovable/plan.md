

## Pre-Final Stone SQFT Redesign

### What changes

The Stone SQFT section needs a complete rework to:
1. **Classify tops as Kitchen or Bath** — AI detects from drawing; fallback rule: depth <= 22" = Bath, else Kitchen
2. **Group by depth within each category** — same-depth sections are summed into one line (total inches), different depths shown as sub-rows
3. **User-selectable backsplash height** — a global input per type (not per row) that applies to all sections; AI detects if double-line backsplash is present
4. **Output: Kitchen SQFT and Bath SQFT per type**, with grand totals for Kitchen total and Bath total across all types

### Data model changes

**`PrefinalStoneRow`** (in `usePrefinalStore.ts`):
- Add `category: 'kitchen' | 'bath'` field
- Remove `isIsland` (not needed in this workflow)
- Keep `label`, `length`, `depth`, `splashHeight`, `room`, `unitType`

**New store fields** (in `PrefinalData`):
- `stoneBacksplashHeight: Record<string, { kitchen: number; bath: number }>` — per unit-type backsplash heights (user-editable, default 0)

**New store actions:**
- `setStoneBacksplashHeight(unitType: string, category: 'kitchen' | 'bath', height: number)`

### Edge function changes (`extract-pdf-countertops/index.ts`)

Update the AI prompt to:
- Classify each section as `"category": "kitchen"` or `"category": "bath"`
- Detect backsplash presence (double-line indicator) and return `"hasBacksplash": true/false`
- Return JSON: `{"countertops":[{"label":"...", "length":120, "depth":25.5, "category":"kitchen", "hasBacksplash":true, "room":"Kitchen"}]}`
- Fallback classification rule in post-processing: depth <= 22" → bath, else → kitchen

### Import dialog changes (`StonePDFImportDialog.tsx`)

- Update `StoneExtractedRow` to include `category: 'kitchen' | 'bath'`
- Review table shows category column (editable dropdown: Kitchen/Bath)
- Remove Island column
- Group rows by category in review for clarity
- Pass category through to `onImport`

### Stone import handler (`PreFinalModule.tsx`)

- When importing, rows already carry `category`
- Aggregate: for each unitType + category + depth, sum all lengths into a single combined row
- Store aggregated rows

### Stone SQFT UI layout (`PreFinalModule.tsx`)

Per unit type, the new layout:

```text
┌─────────────────────────────────────────────────────────┐
│ TYPE A                                                   │
├─────────────────────────────────────────────────────────┤
│ Kitchen Top                                              │
│  Backsplash Height: [__4__]"  (user input)              │
│  ┌────────────┬──────────┬───────────┬──────┐           │
│  │ Depth      │ Total"   │ Splash"   │ SQFT │           │
│  │ 25.5"      │ 312      │ 4         │ XX   │           │
│  │ 36" (island)│ 96      │ 0         │ XX   │           │
│  └────────────┴──────────┴───────────┴──────┘           │
│  Kitchen SQFT: XX                                        │
│                                                          │
│ Bath/Vanity Top                                          │
│  Backsplash Height: [__4__]"  (user input)              │
│  ┌────────────┬──────────┬───────────┬──────┐           │
│  │ Depth      │ Total"   │ Splash"   │ SQFT │           │
│  │ 22"        │ 144      │ 4         │ XX   │           │
│  └────────────┴──────────┴───────────┴──────┘           │
│  Bath SQFT: XX                                           │
└─────────────────────────────────────────────────────────┘
```

SQFT calculation per depth-group: `Math.ceil((totalLength * (depth + backsplashHeight)) / 144)`

At the bottom — two grand total cards:
- **Total Kitchen SQFT** = sum of all types' kitchen sqft × unit count
- **Total Bath SQFT** = sum of all types' bath sqft × unit count

### Files to modify

1. **`supabase/functions/extract-pdf-countertops/index.ts`** — Update prompt for kitchen/bath classification + backsplash detection
2. **`src/hooks/usePrefinalStore.ts`** — Add `category` to `PrefinalStoneRow`, add `stoneBacksplashHeight` state + setter
3. **`src/components/project/StonePDFImportDialog.tsx`** — Add category to extracted rows, update review table
4. **`src/components/project/PreFinalModule.tsx`** — New stone UI with depth-grouped kitchen/bath layout, backsplash height inputs, two grand totals

