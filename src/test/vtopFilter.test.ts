// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isVanityCandidate, extractUnitTypeFromPageText } from '@/lib/vtopFilter';

describe('isVanityCandidate — Judd Homestead PDF cases', () => {
  it('accepts POWDER ROOM 31×22 with oval sink', () => {
    expect(isVanityCandidate(
      { length: 31, depth: 22, hasSink: true, bowlPosition: 'center' },
      '', 'Judd Homestead POWDER ROOM COMMUNITY BUILDING-CB-203'
    )).toBe(true);
  });

  it('accepts UNISEX BATH 32×22 with oval sink', () => {
    expect(isVanityCandidate(
      { length: 32, depth: 22, hasSink: true, bowlPosition: 'center' },
      '', 'Judd Homestead UNISEX BATH COMMUNITY BUILDING-CB-102'
    )).toBe(true);
  });

  it('accepts 1BR-1 (ADA) - AS small vanity 44.5×22 with offset bowl', () => {
    expect(isVanityCandidate(
      { length: 44.5, depth: 22, hasSink: true, bowlPosition: 'offset-left', bowlOffset: 16 },
      '1BR-1 (ADA) - AS', 'Judd Homestead - CT 1BR-1 (ADA) - AS UNIT# BLDG A - 1D'
    )).toBe(true);
  });

  it('accepts 2BR (ADA) Bath-1 vanity', () => {
    expect(isVanityCandidate(
      { length: 44.5, depth: 22, hasSink: true, bowlPosition: 'offset-left', bowlOffset: 16 },
      '2BR (ADA)', 'Judd Homestead 2BR (ADA) Bath-1 Bath-2 UNIT# BLDG C-1A'
    )).toBe(true);
  });

  it('rejects KITCHEN 86.5×25.25 (depth too large)', () => {
    expect(isVanityCandidate(
      { length: 86.5, depth: 25.25, hasSink: true, bowlPosition: 'center' },
      '', 'Judd Homestead KITCHEN COMMUNITY BUILDING-CB-104'
    )).toBe(false);
  });

  it('rejects CORRIDOR 33.5×25.25 (depth too large + corridor context)', () => {
    expect(isVanityCandidate(
      { length: 33.5, depth: 25.25, hasSink: false, bowlPosition: 'center' },
      '', 'Judd Homestead CORRIDOR COMMUNITY BUILDING-CB-105'
    )).toBe(false);
  });

  it('rejects WORK STATION 60×18 (no sink, work-station context)', () => {
    expect(isVanityCandidate(
      { length: 60, depth: 18, hasSink: false, bowlPosition: 'center' },
      '', 'Judd Homestead WORK STATION COMMUNITY BUILDING-CB-204'
    )).toBe(false);
  });

  it('rejects 1BR-1 ADA kitchen leg 116.625×25.5 (depth too large) on a multi-piece page', () => {
    expect(isVanityCandidate(
      { length: 116.625, depth: 25.5, hasSink: true, bowlPosition: 'center' },
      '1BR-1 (ADA) - AS', 'Judd Homestead - CT 1BR-1 (ADA) - AS UNIT# BLDG A - 1D'
    )).toBe(false);
  });

  it('rejects naked 22"-deep rectangle in non-bath room with no sink', () => {
    expect(isVanityCandidate(
      { length: 60, depth: 22, hasSink: false, bowlPosition: 'center' },
      '', 'Judd Homestead LOBBY'
    )).toBe(false);
  });

  it('accepts naked 22"-deep rectangle WHEN bathroom context (e.g. POWDER ROOM with no sink drawn)', () => {
    expect(isVanityCandidate(
      { length: 36, depth: 22, hasSink: false, bowlPosition: 'center' },
      '', 'Judd Homestead POWDER ROOM'
    )).toBe(true);
  });
});

describe('extractUnitTypeFromPageText — Judd Homestead PDF cases', () => {
  it('detects "1BR-1 (ADA) - AS" from "<NAME> Countertops Drawing #" footer', () => {
    const t = '116 5/8" 39" 77 5/8" 25 1/2" Judd Homestead - CT 1BR-1 (ADA) - AS UNIT# BLDG A - 1D BLDG B1 - 1D 22" 44 1/2" 1BR-1 (ADA) - AS Countertops Drawing #: 1 No Scale.';
    const detected = extractUnitTypeFromPageText(t);
    expect(detected.toUpperCase()).toContain('1BR-1');
    expect(detected.toUpperCase()).toContain('AS');
  });

  it('detects "POWDER ROOM" from footer', () => {
    const t = '31" 15 1/2" 15 1/2" 22" Judd Homestead POWDER ROOM COMMUNITY BUILDING-CB-203 POWDER ROOM Countertops Drawing #: 1 No Scale.';
    const detected = extractUnitTypeFromPageText(t);
    expect(detected.toUpperCase()).toContain('POWDER');
  });

  it('detects "UNISEX BATH" from footer', () => {
    const t = '32" 16" 16" 22" Judd Homestead UNISEX BATH COMMUNITY BUILDING-CB-102 UNISEX BATH Countertops Drawing #: 1 No Scale.';
    const detected = extractUnitTypeFromPageText(t);
    expect(detected.toUpperCase()).toContain('UNISEX');
  });

  it('detects "2BR (ADA)" from footer', () => {
    const t = 'Judd Homestead 2BR (ADA) UNIT# BLDG C-1A Bath-1 Bath-2 2BR (ADA) Countertops Drawing #: 1 No Scale.';
    const detected = extractUnitTypeFromPageText(t);
    expect(detected.toUpperCase()).toContain('2BR');
  });

  it('detects classic "TYPE 1.1A (ADA) UNIT#" pattern', () => {
    const t = 'Countertops TYPE 1.1A (ADA) UNIT# 101 102 103';
    const detected = extractUnitTypeFromPageText(t);
    expect(detected.toUpperCase()).toContain('1.1A');
  });
});
