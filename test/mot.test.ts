import { describe, expect, it } from 'vitest';
import {
  buildMileageTimeline,
  buildMotHistory,
  detectClocking,
  odometerMiles,
  parseTestDate,
  summariseMot,
} from '../src/mot/dvsa';
import type { MotRaw, MotTest } from '../src/types';

const test = (overrides: Partial<MotTest> = {}): MotTest => ({
  completedDate: '2023-05-12T10:57:24.000Z',
  testResult: 'PASSED',
  expiryDate: '2024-05-11',
  odometerValue: '60000',
  odometerUnit: 'MI',
  ...overrides,
});

const raw = (tests: MotTest[], overrides: Partial<MotRaw> = {}): MotRaw => ({
  registration: 'AB12CDE',
  make: 'MINI',
  model: 'COOPER',
  motTests: tests,
  ...overrides,
});

describe('parseTestDate', () => {
  it('reads the current ISO format', () => {
    expect(parseTestDate('2023-05-12T10:57:24.000Z')).toBe('2023-05-12');
  });

  it('reads the dotted format older records still use', () => {
    // DVSA changed format mid-life; both eras appear in one vehicle's history.
    expect(parseTestDate('2018.05.12 10:57:24')).toBe('2018-05-12');
  });

  it('returns null rather than an Invalid Date for anything else', () => {
    expect(parseTestDate('last Tuesday')).toBeNull();
    expect(parseTestDate(undefined)).toBeNull();
  });
});

describe('odometerMiles', () => {
  it('takes a mile reading as-is', () => {
    expect(odometerMiles(test({ odometerValue: '61234', odometerUnit: 'MI' }))).toBe(61234);
  });

  it('converts a kilometre reading', () => {
    expect(odometerMiles(test({ odometerValue: '100000', odometerUnit: 'km' }))).toBe(62137);
  });

  it('ignores a test with no usable reading', () => {
    expect(odometerMiles(test({ odometerValue: undefined }))).toBeNull();
    expect(odometerMiles(test({ odometerValue: 'unknown' }))).toBeNull();
    // DVSA sends explicit nulls, not absent fields, when a reading was
    // UNREADABLE — as on the COVID-extension records of 2020.
    expect(odometerMiles(test({ odometerValue: null, odometerUnit: null }))).toBeNull();
  });
});

describe('buildMileageTimeline', () => {
  it('orders readings oldest first whatever order DVSA returned', () => {
    const timeline = buildMileageTimeline([
      test({ completedDate: '2023-05-12T00:00:00.000Z', odometerValue: '60000' }),
      test({ completedDate: '2021-05-12T00:00:00.000Z', odometerValue: '40000' }),
      test({ completedDate: '2022-05-12T00:00:00.000Z', odometerValue: '50000' }),
    ]);

    expect(timeline.map((r) => r.miles)).toEqual([40000, 50000, 60000]);
  });

  it('drops tests with no odometer reading instead of treating them as zero', () => {
    const timeline = buildMileageTimeline([
      test({ completedDate: '2021-05-12T00:00:00.000Z', odometerValue: '40000' }),
      test({ completedDate: '2022-05-12T00:00:00.000Z', odometerValue: undefined }),
    ]);

    expect(timeline).toHaveLength(1);
  });
});

describe('detectClocking', () => {
  it('flags an odometer that reads lower than an earlier test', () => {
    const timeline = buildMileageTimeline([
      test({ completedDate: '2021-05-12T00:00:00.000Z', odometerValue: '80000' }),
      test({ completedDate: '2022-05-12T00:00:00.000Z', odometerValue: '52000' }),
    ]);

    expect(detectClocking(timeline)).toBe(true);
  });

  it('leaves an honest history alone', () => {
    const timeline = buildMileageTimeline([
      test({ completedDate: '2021-05-12T00:00:00.000Z', odometerValue: '40000' }),
      test({ completedDate: '2022-05-12T00:00:00.000Z', odometerValue: '52000' }),
    ]);

    expect(detectClocking(timeline)).toBe(false);
  });

  it('does not invent clocking from a kilometre reading among mile readings', () => {
    // An import often has one test recorded in km. Read as miles it looks like
    // the odometer leapt forward and then back — two false alarms from one row.
    const timeline = buildMileageTimeline([
      test({ completedDate: '2021-05-12T00:00:00.000Z', odometerValue: '40000', odometerUnit: 'MI' }),
      test({ completedDate: '2022-05-12T00:00:00.000Z', odometerValue: '72000', odometerUnit: 'KM' }),
      test({ completedDate: '2023-05-12T00:00:00.000Z', odometerValue: '46000', odometerUnit: 'MI' }),
    ]);

    expect(timeline.map((r) => r.miles)).toEqual([40000, 44739, 46000]);
    expect(detectClocking(timeline)).toBe(false);
  });
});

describe('summariseMot', () => {
  const history = [
    test({ completedDate: '2021-05-12T00:00:00.000Z', odometerValue: '40000', expiryDate: '2022-05-11' }),
    test({ completedDate: '2022-05-12T00:00:00.000Z', odometerValue: '52000', expiryDate: '2023-05-11' }),
    test({ completedDate: '2023-05-12T00:00:00.000Z', odometerValue: '61000', expiryDate: '2024-05-11' }),
  ];

  it('summarises the latest state', () => {
    const summary = summariseMot(raw(history));

    expect(summary).toMatchObject({
      registration: 'AB12CDE',
      vehicle: 'MINI COOPER',
      lastTestDate: '2023-05-12',
      expiryDate: '2024-05-11',
      latestOdometer: 61000,
      testCount: 3,
      possibleClocking: false,
    });
  });

  it('skips a test whose expiry is explicitly null', () => {
    const summary = summariseMot(
      raw([
        test({ completedDate: '2023-05-31T00:00:00.000Z', testResult: 'FAILED', expiryDate: null }),
        test({ completedDate: '2023-06-01T00:00:00.000Z', expiryDate: '2024-06-11' }),
      ]),
    );

    expect(summary.expiryDate).toBe('2024-06-11');
  });

  it('takes the expiry from the most recent pass, not a later failure', () => {
    // A failed retest does not shorten a certificate that is still running.
    const summary = summariseMot(
      raw([...history, test({ completedDate: '2023-09-01T00:00:00.000Z', testResult: 'FAILED', expiryDate: undefined })]),
    );

    expect(summary.expiryDate).toBe('2024-05-11');
    expect(summary.lastTestDate).toBe('2023-09-01');
  });

  it('flags an advert claiming fewer miles than the last MOT recorded', () => {
    const summary = summariseMot(raw(history), { mileage: 48000 });

    expect(summary.mileageMismatch).toBe(13000);
  });

  it('says nothing when the advert reads higher — a car gains miles after a test', () => {
    expect(summariseMot(raw(history), { mileage: 66000 }).mileageMismatch).toBeNull();
  });

  it('tolerates a rounded advert figure', () => {
    // "61,000 miles" advertised against a 61,000 reading must not warn, and nor
    // should the few hundred miles of slack either side of it.
    expect(summariseMot(raw(history), { mileage: 60800 }).mileageMismatch).toBeNull();
  });

  it('catches a plate registered to a different make', () => {
    const summary = summariseMot(raw(history, { make: 'FORD', model: 'FIESTA' }), { make: 'MINI' });

    expect(summary.plateMismatch).toBe('FORD FIESTA');
  });

  it('accepts the same make written differently', () => {
    // DVSA shouts, AutoTrader doesn't; "Mercedes-Benz" and "MERCEDES BENZ" are
    // the same car.
    expect(summariseMot(raw(history, { make: 'MERCEDES BENZ' }), { make: 'Mercedes-Benz' }).plateMismatch).toBeNull();
    expect(summariseMot(raw(history), { make: 'Mini' }).plateMismatch).toBeNull();
  });

  it('holds no opinion when there is nothing to compare against', () => {
    const summary = summariseMot(raw(history));

    expect(summary.mileageMismatch).toBeNull();
    expect(summary.plateMismatch).toBeNull();
  });

  it('copes with a vehicle DVSA holds but has never tested', () => {
    const summary = summariseMot(raw([]));

    expect(summary).toMatchObject({
      testCount: 0,
      latestOdometer: null,
      lastTestDate: null,
      possibleClocking: false,
    });
  });
});

describe('buildMotHistory', () => {
  it('returns tests newest first, whatever order they arrived in', () => {
    const history = buildMotHistory(
      raw([
        test({ completedDate: '2021-05-12T00:00:00.000Z', odometerValue: '40000' }),
        test({ completedDate: '2023-05-12T00:00:00.000Z', odometerValue: '61000' }),
        test({ completedDate: '2022-05-12T00:00:00.000Z', odometerValue: '52000' }),
      ]),
      { fetchedAt: '2026-08-19T00:00:00.000Z', source: 'cache' },
    );

    expect(history.tests.map((t) => parseTestDate(t.completedDate))).toEqual([
      '2023-05-12',
      '2022-05-12',
      '2021-05-12',
    ]);
    // The timeline runs the other way: it is read as a trend.
    expect(history.mileageTimeline.map((r) => r.miles)).toEqual([40000, 52000, 61000]);
    expect(history.source).toBe('cache');
  });
});
