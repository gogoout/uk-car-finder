import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, 'fixtures');

export const readFixture = (name: string): string => readFileSync(join(DIR, name), 'utf8');

/**
 * Real pages captured from autotrader.co.uk, chosen to cover the shapes that
 * broke naive parsing during recon:
 *
 *  - MINI:      no service history, full vehicleCheck block, VRM leaked in a
 *               dealer deep-link, priceIndicator NOANALYSIS.
 *  - MAZDA_FSH: FULL service history with a last-service date, and a vehicle
 *               check where IMPORTED is FAILED.
 *  - MAZDA_NO_CHECK: no `vehicleCheck` block at all, priceIndicator LOW.
 */
export const MINI = 'car-details-202608034752643.html';
export const MAZDA_FSH = 'car-details-202601269420779-fullhistory.html';
export const MAZDA_NO_CHECK = 'car-details-202607023839067-nocheck.html';
export const SEARCH_RESULTS = 'search-results-mini-cooper.json';

/** A seller with no `seller.name`, whose town lives at `seller.location.town`. */
export const MAZDA_NO_SELLER_NAME = 'car-details-202607224391815-private-seller.html';
