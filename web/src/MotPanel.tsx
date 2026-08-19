import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type MotHistory, type MotTest } from './api';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { miles, relativeTime, shortDate } from './format';

const passed = (test: MotTest): boolean => /^pass/i.test(test.testResult);

/**
 * Dangerous and major defects are why a car failed; minor and advisory are
 * what to look at on the day. Different colours, because they are different
 * decisions.
 */
function defectTone(type: string): string {
  if (/dangerous|major|fail/i.test(type)) return 'bad';
  return 'warn';
}

function TestRow({ test }: { test: MotTest }) {
  const defects = test.defects ?? [];
  const odometer =
    test.odometerValue && /^\d+$/.test(test.odometerValue)
      ? `${Number(test.odometerValue).toLocaleString('en-GB')} ${/^km$/i.test(test.odometerUnit ?? '') ? 'km' : 'miles'}`
      : 'no reading';

  return (
    <div className="mot-test">
      <div className="spread">
        <strong className="small">{shortDate(test.completedDate)}</strong>
        <span className={`badge ${passed(test) ? 'good' : 'bad'}`}>
          {passed(test) ? 'Pass' : 'Fail'}
        </span>
      </div>
      <div className="tiny muted">
        {odometer}
        {test.expiryDate ? ` · expired ${shortDate(test.expiryDate)}` : ''}
      </div>
      {defects.length > 0 && (
        <ul className="mot-defects tiny">
          {defects.map((defect, i) => (
            <li key={`${defect.type}-${i}`}>
              <span className={`badge ${defectTone(defect.type)}`}>{defect.type}</span>{' '}
              {defect.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The MOT panel.
 *
 * DVSA is keyed on the registration plate, which AutoTrader never publishes —
 * so this starts with a plate box, and the plate is saved against the car so
 * you only type it once.
 *
 * What it is really for is the two things the advert cannot tell you: an
 * odometer that reads lower than an earlier test, and an advertised mileage
 * that the last MOT contradicts. Those go at the top; the test-by-test history
 * is supporting evidence.
 */
export function MotPanel({
  advertId,
  vrm,
  onVrmSaved,
}: {
  advertId: string;
  vrm: string | null;
  onVrmSaved: (vrm: string) => void;
}) {
  const [history, setHistory] = useState<MotHistory | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [plate, setPlate] = useState(vrm ?? '');
  // The plate we have already asked about, so saving one doesn't fetch twice:
  // `savePlate` looks it up, and the prop then changes and would look it up
  // again.
  const askedAbout = useRef<string | null>(null);

  const typedPlate = plate.trim().toUpperCase().replace(/\s+/g, '');

  const lookup = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        setHistory(await api.getMot(advertId, refresh));
      } catch (err) {
        setHistory(null);
        setError({
          message: err instanceof Error ? err.message : 'MOT lookup failed',
          status: err instanceof ApiError ? err.status : 0,
        });
      } finally {
        setLoading(false);
      }
    },
    [advertId],
  );

  // A plate already on file means the answer is a cache hit away, so fetch it
  // rather than making you press a button to see what we already hold.
  useEffect(() => {
    if (vrm && askedAbout.current !== vrm) {
      askedAbout.current = vrm;
      void lookup();
    }
  }, [vrm, lookup]);

  const savePlate = async () => {
    if (!typedPlate) return;
    setLoading(true);
    try {
      await api.setVrm(advertId, typedPlate);
      // Tell the list first: the saved plate is what the next lookup keys on.
      onVrmSaved(typedPlate);
      askedAbout.current = typedPlate;
      await lookup();
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : 'Could not save the plate',
        status: err instanceof ApiError ? err.status : 0,
      });
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <input
          value={plate}
          placeholder="Registration plate"
          aria-label="Registration plate"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setPlate(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void savePlate()}
          style={{ flex: 1, minWidth: 140 }}
        />
        <button
          type="button"
          className="primary"
          onClick={() => void savePlate()}
          disabled={loading || !typedPlate || typedPlate === vrm}
        >
          Check
        </button>
      </div>

      {!vrm && !history && !error && (
        <div className="tiny muted">
          AutoTrader never publishes the plate. Take it from the photos or ask the seller — it is
          saved against this car, so you only type it once.
        </div>
      )}

      {loading && <div className="small muted">Checking with DVSA…</div>}

      {error && (
        <div className={error.status === 404 || error.status === 501 ? 'banner info' : 'banner'}>
          {/* Each of these means something different, and only one of them is
              anything to worry about. */}
          {error.status === 501
            ? 'MOT lookups are not configured on this deployment — the DVSA credentials are missing.'
            : error.status === 404
              ? error.message
              : `MOT lookup failed: ${error.message}`}
        </div>
      )}

      {history && !loading && (
        <>
          {history.possibleClocking && (
            <div className="banner">
              <AlertTriangle size={16} aria-hidden="true" /> Possible clocking — an MOT reads fewer
              miles than an earlier one.
            </div>
          )}

          {history.mileageMismatch !== null && (
            <div className="banner">
              <AlertTriangle size={16} aria-hidden="true" /> The last MOT reads{' '}
              {miles(history.latestOdometer)}, {miles(history.mileageMismatch)} above the advert.
            </div>
          )}

          {history.plateMismatch && (
            <div className="banner">
              <AlertTriangle size={16} aria-hidden="true" /> That plate is registered to a{' '}
              {history.plateMismatch}. Check you have it right.
            </div>
          )}

          <dl className="kv">
            <div>
              <dt>Vehicle</dt>
              <dd>{history.vehicle ?? '—'}</dd>
            </div>
            <div>
              <dt>MOT expires</dt>
              <dd>{shortDate(history.expiryDate)}</dd>
            </div>
            <div>
              <dt>Latest reading</dt>
              <dd>{miles(history.latestOdometer)}</dd>
            </div>
            <div>
              <dt>Tests</dt>
              <dd>{history.testCount}</dd>
            </div>
            {history.firstUsedDate && (
              <div>
                <dt>First used</dt>
                <dd>{shortDate(history.firstUsedDate)}</dd>
              </div>
            )}
          </dl>

          {history.mileageTimeline.length > 1 && (
            <div className="small">
              <span className="muted">Odometer </span>
              {history.mileageTimeline.map((reading, i) => (
                <span key={reading.date}>
                  {i > 0 && <span className="muted"> → </span>}
                  {reading.miles.toLocaleString('en-GB')}
                </span>
              ))}
            </div>
          )}

          {history.tests.length === 0 ? (
            <div className="small muted">
              DVSA holds this vehicle but no completed tests — usually a car under three years old.
            </div>
          ) : (
            <div className="mot-tests">
              {history.tests.map((test, i) => (
                <TestRow key={test.motTestNumber ?? `${test.completedDate}-${i}`} test={test} />
              ))}
            </div>
          )}

          <div className="spread tiny muted">
            <span>
              {history.source === 'stale-fallback'
                ? `DVSA unreachable — showing the copy from ${relativeTime(history.fetchedAt)}`
                : `checked ${relativeTime(history.fetchedAt)}`}
            </span>
            <button className="link" type="button" onClick={() => void lookup(true)}>
              <RefreshCw size={12} aria-hidden="true" /> re-check
            </button>
          </div>
        </>
      )}
    </div>
  );
}
