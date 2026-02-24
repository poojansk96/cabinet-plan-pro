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

  const series = specs.doorStyleSeries || '';
  const framing = specs.doorStyleFraming || '';
  const construction = specs.doorStyleConstruction
    ? `${specs.doorStyleConstruction} construction`
    : '';

  const name = specs.doorStyleName === 'Other'
    ? specs.doorStyleNameCustom
    : specs.doorStyleName;

  // Build: Manufacturer  Framing  Construction — Name
  const parts = [manufacturer, series, framing, construction].filter(Boolean);
  let result = parts.join(' ');
  if (style) result += ` ${style}`;
  if (name) result += ` — ${name}`;

  return result;
}

type AnySpecs = ProjectSpecs & Record<string, any>;

function resolveCustom(value?: string, custom?: string): string {
  if (!value) return '';
  return value === 'Other' ? (custom || '') : value;
}

/**
 * Combines kitchen tops fields into "Material - Vendor - Color" string.
 */
export function formatKitchenTops(specs?: AnySpecs): string {
  if (!specs) return '';
  const material = resolveCustom(specs.countertops);
  if (!material) return '';

  const parts = [material];

  if (material === 'Laminate') {
    const substrate = resolveCustom(specs.laminateSubstrate, specs.laminateSubstrateCustom);
    const color = resolveCustom(specs.laminateColor, specs.laminateColorCustom);
    if (substrate) parts.push(substrate);
    if (color) parts.push(color);
  } else {
    const vendor = resolveCustom(specs.countertopManufacturer, specs.countertopManufacturerCustom);
    const color = resolveCustom(specs.countertopColor, specs.countertopColorCustom);
    if (vendor) parts.push(vendor);
    if (color) parts.push(color);
  }

  return parts.join(' - ');
}

/**
 * Combines vanity tops fields into a descriptive string.
 */
export function formatVanityTops(specs?: AnySpecs): string {
  if (!specs) return '';
  if (specs.vanitySameAsKitchen) return `Same as Kitchen (${formatKitchenTops(specs)})`;

  const material = resolveCustom(specs.vanityCountertops);
  if (!material) return '';

  const parts = [material];

  if (material === 'Cultured Marble' || material === 'Swanstone') {
    const bowl = resolveCustom(specs.vanityBowlStyle, specs.vanityBowlStyleCustom);
    const color = resolveCustom(specs.vanityCMColor, specs.vanityCMColorCustom);
    if (bowl) parts.push(bowl);
    if (color) parts.push(color);
  } else if (material === 'Laminate') {
    const substrate = resolveCustom(specs.vanityLaminateSubstrate, specs.vanityLaminateSubstrateCustom);
    const color = resolveCustom(specs.vanityLaminateColor, specs.vanityLaminateColorCustom);
    if (substrate) parts.push(substrate);
    if (color) parts.push(color);
  } else {
    const vendor = resolveCustom(specs.vanityManufacturer, specs.vanityManufacturerCustom);
    const color = resolveCustom(specs.vanityColor, specs.vanityColorCustom);
    if (vendor) parts.push(vendor);
    if (color) parts.push(color);
  }

  return parts.join(' - ');
}

/**
 * Combines additional tops fields into a descriptive string.
 */
export function formatAdditionalTops(specs?: AnySpecs): string {
  if (!specs || !specs.additionalTopsEnabled) return '';

  const label = specs.additionalTopsLabel || 'Additional Tops';
  const material = resolveCustom(specs.additionalTops);
  if (!material) return label;

  const parts = [material];

  if (material === 'Laminate') {
    const substrate = resolveCustom(specs.additionalTopsLaminateSubstrate, specs.additionalTopsLaminateSubstrateCustom);
    const color = resolveCustom(specs.additionalTopsLaminateColor, specs.additionalTopsLaminateColorCustom);
    if (substrate) parts.push(substrate);
    if (color) parts.push(color);
  } else {
    const vendor = resolveCustom(specs.additionalTopsManufacturer, specs.additionalTopsManufacturerCustom);
    const color = resolveCustom(specs.additionalTopsColor, specs.additionalTopsColorCustom);
    if (vendor) parts.push(vendor);
    if (color) parts.push(color);
  }

  return `${label}: ${parts.join(' - ')}`;
}
