import { describe, expect, it } from 'vitest';
import { effectiveCombo } from '../src/types';
import { buildFilters } from '../src/autotrader/filters';
import { mentionsImport } from '../src/autotrader/normalise';
import type { Combo } from '../src/types';

const combo = (filters: Record<string, string[]> = {}): Combo => ({
  id: 'c1',
  label: 'MINI Cooper',
  filters: { make: ['MINI'], ...filters },
});

describe('effectiveCombo', () => {
  it("layers the search's globals under the combination's own filters", () => {
    const merged = effectiveCombo(combo({ max_price: ['7000'] }), {
      max_price: ['8000'],
      max_mileage: ['85000'],
      is_writeoff: ['exclude'],
    });

    // The combination wins where it sets the same filter...
    expect(merged.filters.max_price).toEqual(['7000']);
    // ...and inherits the rest.
    expect(merged.filters.max_mileage).toEqual(['85000']);
    expect(merged.filters.is_writeoff).toEqual(['exclude']);
    expect(merged.filters.make).toEqual(['MINI']);
  });

  it('applies a global to a combination that sets nothing of its own', () => {
    expect(effectiveCombo(combo(), { max_price: ['8000'] }).filters.max_price).toEqual(['8000']);
  });

  it('returns the combination untouched when there are no globals', () => {
    const original = combo({ max_price: ['7000'] });
    expect(effectiveCombo(original, {})).toBe(original);
    expect(effectiveCombo(original, undefined)).toBe(original);
  });

  it('does not mutate either input', () => {
    const globals = { max_price: ['8000'] };
    const original = combo();
    effectiveCombo(original, globals);

    expect(globals).toEqual({ max_price: ['8000'] });
    expect(original.filters).toEqual({ make: ['MINI'] });
  });

  it('keeps the combination id and label', () => {
    const merged = effectiveCombo(combo(), { max_price: ['8000'] });
    expect(merged.id).toBe('c1');
    expect(merged.label).toBe('MINI Cooper');
  });
});

describe('precedence through buildFilters', () => {
  it('is combo over global over search-level', () => {
    // `distance` is search-level, so all three layers are in play at once.
    const merged = effectiveCombo(combo({ distance: ['10'] }), {
      distance: ['100'],
      max_price: ['8000'],
    });
    const filters = buildFilters(merged, { postcode: 'SW1A 1AA', radius: 200 });
    const byName = Object.fromEntries(filters.map((f) => [f.filter, f.selected]));

    expect(byName.distance).toEqual(['10']);
    expect(byName.max_price).toEqual(['8000']);
    expect(byName.postcode).toEqual(['SW1A 1AA']);
    // One distance filter, not three.
    expect(filters.filter((f) => f.filter === 'distance')).toHaveLength(1);
  });

  it('lets a global reach AutoTrader when the combination is silent', () => {
    const merged = effectiveCombo(combo(), { is_writeoff: ['exclude'] });
    const filters = buildFilters(merged, { postcode: 'SW1A 1AA', radius: 50 });

    expect(filters.find((f) => f.filter === 'is_writeoff')?.selected).toEqual(['exclude']);
  });
});

/**
 * A wrong badge here costs a wasted trip, so the rejections matter more than
 * the matches.
 */
describe('mentionsImport', () => {

  it.each([
    'Japanese import, low mileage',
    'This car is a fresh import from Japan',
    'Grey imported vehicle, excellent condition',
    'Imported 2016 model',
  ])('detects %s', (text) => {
    expect(mentionsImport(text)).toBe(true);
  });

  it.each([
    ['a negation', 'Not imported, UK supplied from new'],
    ['never', 'Never imported'],
    ['non', 'Non import, one owner'],
    ['no', 'UK car, no import history'],
    ['parts rather than the car', 'Fitted with imported parts throughout'],
    ['spec rather than the car', 'Import spec alloys'],
    ['a word that merely starts the same', 'Important: MOT due soon'],
  ])('rejects %s', (_label, text) => {
    expect(mentionsImport(text)).toBe(false);
  });

  it('handles an advert with no text at all', () => {
    expect(mentionsImport(null)).toBe(false);
    expect(mentionsImport('')).toBe(false);
    expect(mentionsImport(undefined)).toBe(false);
  });
});
