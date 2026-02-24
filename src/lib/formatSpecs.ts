import type { ProjectSpecs } from '@/types/project';

/**
 * Combines all door-style sub-fields into a single descriptive string.
 * Example output: "Overseas Framed Plywood construction — Avon Group 9"
 */
export function formatDoorStyle(specs?: ProjectSpecs & Record<string, any>): string {
  if (!specs) return '';

  const manufacturer = specs.doorStyle === 'Other'
    ? specs.doorStyleCustom
    : specs.doorStyle;

  if (!manufacturer) return '';

  const style = specs.doorStyleStyle === 'Other'
    ? specs.doorStyleStyleCustom
    : specs.doorStyleStyle;

  const framing = specs.doorStyleFraming || '';
  const construction = specs.doorStyleConstruction
    ? `${specs.doorStyleConstruction} construction`
    : '';

  const name = specs.doorStyleName === 'Other'
    ? specs.doorStyleNameCustom
    : specs.doorStyleName;

  // Build: Manufacturer  Framing  Construction — Name
  const parts = [manufacturer, framing, construction].filter(Boolean);
  let result = parts.join(' ');
  if (style) result += ` ${style}`;
  if (name) result += ` — ${name}`;

  return result;
}
