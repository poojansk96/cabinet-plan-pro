import type { ProjectSpecs } from '@/types/project';

type AnySpecs = ProjectSpecs;

function resolveCustom(value?: string, custom?: string): string {
  if (!value) return '';
  return value === 'Other' ? (custom || '') : value;
}

/**
 * Combines all door-style sub-fields into a manufacturer-specific descriptive string.
 *
 * Overseas:  "Door style name" - "Color" from Overseas
 * India:     "Door style name" - "Construction" - "Color" from India
 * Legacy:    "Series" - "Door style name" - "Construction" - "Framing" - "Style" - "Color" from Legacy
 * Others:    Original format
 */
export function formatDoorStyle(specs?: AnySpecs): string {
  if (!specs) return '';

  const manufacturer = specs.doorStyle === 'Other'
    ? specs.doorStyleCustom
    : specs.doorStyle;

  if (!manufacturer) return '';

  const name = resolveCustom(specs.doorStyleName, specs.doorStyleNameCustom);
  const color = resolveCustom(specs.doorStyleFinishColor, specs.doorStyleFinishColorCustom);
  const finish = specs.doorStyleFinish || '';
  const construction = specs.doorStyleConstruction || '';
  const series = specs.doorStyleSeries || '';
  const framing = specs.doorStyleFraming || '';
  const style = resolveCustom(specs.doorStyleStyle, specs.doorStyleStyleCustom);

  if (manufacturer === 'Overseas') {
    // "Door style name" - "Color" from Overseas
    const parts = [name, color].filter(Boolean);
    return parts.length > 0 ? `${parts.join(' - ')} from Overseas` : 'Overseas';
  }

  if (manufacturer === 'India') {
    // "Door style name" - "Construction" - "Color" from India
    const constr = construction ? `${construction} construction` : '';
    const parts = [name, constr, color].filter(Boolean);
    return parts.length > 0 ? `${parts.join(' - ')} from India` : 'India';
  }

  if (manufacturer === 'Legacy') {
    // "Series" - "Door style name" - "Construction" - "Framing" - "Style" - "Color" from Legacy
    const constr = construction ? `${construction} construction` : '';
    const parts = [series, name, constr, framing, style, color].filter(Boolean);
    return parts.length > 0 ? `${parts.join(' - ')} from Legacy` : 'Legacy';
  }

  // Other manufacturers - original format
  const constr = construction ? `${construction} construction` : '';
  const parts = [manufacturer, series, framing, constr].filter(Boolean);
  let result = parts.join(' ');
  if (style) result += ` ${style}`;
  if (name) result += ` — ${name}`;
  return result;
}

/**
 * Returns an object with { value, pending } pairs for door style fields.
 * Used by Excel export to mark missing fields in red.
 */
export function getDoorStylePendingFields(specs?: AnySpecs): { label: string; value: string; pending: string }[] {
  if (!specs || !specs.doorStyle) return [];
  const manufacturer = specs.doorStyle;
  const name = resolveCustom(specs.doorStyleName, specs.doorStyleNameCustom);
  const color = resolveCustom(specs.doorStyleFinishColor, specs.doorStyleFinishColorCustom);
  const finish = specs.doorStyleFinish || '';
  const construction = specs.doorStyleConstruction || '';
  const series = specs.doorStyleSeries || '';
  const framing = specs.doorStyleFraming || '';
  const style = resolveCustom(specs.doorStyleStyle, specs.doorStyleStyleCustom);

  const fields: { label: string; value: string; pending: string }[] = [];

  if (manufacturer === 'Overseas') {
    fields.push({ label: 'Door Style Name', value: name, pending: name ? '' : 'Door style name is pending' });
    fields.push({ label: 'Door Style Finish', value: finish, pending: finish ? '' : 'Door style finish is pending' });
    fields.push({ label: 'Door Style Color', value: color, pending: color ? '' : 'Door style color is pending' });
  } else if (manufacturer === 'India') {
    fields.push({ label: 'Door Style Name', value: name, pending: name ? '' : 'Door style name is pending' });
    fields.push({ label: 'Construction', value: construction, pending: construction ? '' : 'Construction is pending' });
    fields.push({ label: 'Door Style Finish', value: finish, pending: finish ? '' : 'Door style finish is pending' });
    fields.push({ label: 'Door Style Color', value: color, pending: color ? '' : 'Door style color is pending' });
  } else if (manufacturer === 'Legacy') {
    fields.push({ label: 'Series', value: series, pending: series ? '' : 'Series is pending' });
    fields.push({ label: 'Door Style Name', value: name, pending: name ? '' : 'Door style name is pending' });
    fields.push({ label: 'Construction', value: construction, pending: construction ? '' : 'Construction is pending' });
    fields.push({ label: 'Framing', value: framing, pending: framing ? '' : 'Framing is pending' });
    fields.push({ label: 'Style', value: style, pending: style ? '' : 'Style is pending' });
    fields.push({ label: 'Door Style Color', value: color, pending: color ? '' : 'Door style color is pending' });
  }

  return fields;
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
