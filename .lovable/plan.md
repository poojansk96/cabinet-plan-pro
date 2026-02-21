

# Fix W3030 Quantity Detection Issue

## Problem
The AI vision model (Gemini 2.5 Flash) consistently returns quantity 1 for W3030 even when 2 cabinet boxes are visible in the elevation drawing. The current prompt improvements have not been sufficient to make the AI correctly count physical cabinet boxes.

## Root Cause
Looking at the edge function logs, the AI returns `W3030B` with quantity 1 from a single page. The prompt tells the AI to count boxes, but the model is not reliably distinguishing adjacent identical cabinet rectangles visually. This is a limitation of prompt-based instruction alone.

## Solution: Multi-Pronged Approach

### 1. Increase Image Resolution for Better Box Detection
Currently, pages are rendered at a default scale. Increasing the rendering scale will give the AI more visual detail to distinguish adjacent cabinet boxes.

**File:** `src/components/project/ShopDrawingImportDialog.tsx`
- Update `renderPageToBase64()` to use a higher scale (e.g., scale 3 instead of default) for sharper images

### 2. Switch to a More Capable Model for Cabinet Extraction
Use `gemini-2.5-pro` instead of `gemini-2.5-flash` for cabinet label extraction. The Pro model has stronger visual reasoning and is better at counting objects in technical drawings.

**File:** `supabase/functions/extract-pdf-labels/index.ts`
- Change the model from `gemini-2.5-flash` to `gemini-2.5-pro` for more accurate visual analysis

### 3. Add Chain-of-Thought Reasoning to the Prompt
Add explicit instructions for the AI to first list every cabinet box it sees with position descriptions before producing the final JSON. This forces the model to "think" through each box individually.

**File:** `supabase/functions/extract-pdf-labels/index.ts`
- Update the prompt to include a step-by-step counting instruction:
  - "First, mentally scan the elevation from left to right. For each cabinet box, note its position (far left, center-left, etc.) and its SKU label."
  - "Then group by SKU and count the distinct boxes per SKU to determine quantity."
- Increase `maxOutputTokens` to accommodate the reasoning output
- Add a post-processing step to extract only the final JSON from the response (since the model may output reasoning text before the JSON)

### 4. Increase Temperature Slightly
A temperature of 0.1 may cause the model to be too conservative. Raising it slightly to 0.2 may help with visual interpretation.

**File:** `supabase/functions/extract-pdf-labels/index.ts`
- Change temperature from 0.1 to 0.2

## Technical Details

### Changes to `renderPageToBase64` in ShopDrawingImportDialog.tsx
```text
- Current: renders at default scale (likely 1-2x)  
- Updated: render at scale 3 for higher resolution images sent to AI
```

### Changes to edge function `extract-pdf-labels/index.ts`
```text
- Model: gemini-2.5-flash -> gemini-2.5-pro  
- Temperature: 0.1 -> 0.2  
- maxOutputTokens: 4096 -> 8192  
- Prompt: Add chain-of-thought counting instructions  
- Response parsing: Extract JSON after any reasoning text  
```

### Prompt Addition (excerpt)
```text
COUNTING METHOD:
Before producing JSON, mentally scan the elevation LEFT to RIGHT.
For each distinct cabinet rectangle you see, note:
  - Its approximate horizontal position (e.g. "far left", "center", "right of sink")
  - The SKU label it belongs to
Then count how many distinct rectangles share each SKU and use that as the quantity.
```

### Response Parsing Update
Since chain-of-thought may produce text before JSON, add logic to find the last JSON object in the response:
```text
- Search for the last occurrence of {"items": or {"unitTypeName":
- Parse from that position
- Fall back to current parsing if not found
```

## Files to Modify
1. `supabase/functions/extract-pdf-labels/index.ts` - Model, prompt, temperature, token limit, response parsing
2. `src/components/project/ShopDrawingImportDialog.tsx` - Image rendering scale

