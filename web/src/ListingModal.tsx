import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Gallery } from './Gallery';
import { CopyButton } from './CopyButton';
import { PRICE_LABELS, priceTone, SERVICE_LABELS, serviceTone } from './format';
import type { FullDetail } from '../../src/autotrader/fullDetail';
import { ChevronDown, ChevronRight, ExternalLink, X } from 'lucide-react';

/** Collapsible section, matching the accordion used by the filter editor. */
function Section({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="facet-group">
      <button type="button" className="facet-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="facet-caret" aria-hidden="true">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="facet-title">{title}</span>
        {count !== undefined && <span className="facet-summary tiny muted">{count}</span>}
      </button>
      {open && <div className="facet-body">{children}</div>}
    </section>
  );
}

/**
 * Everything AutoTrader publishes about one advert.
 *
 * Fetched when opened rather than stored, so the photos, price and availability
 * are whatever they are right now — including the advert having sold, which is
 * worth knowing before you drive to see it.
 */
export function ListingModal({ advertId, onClose }: { advertId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<FullDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getListingDetail(advertId)
      .then((data) => !cancelled && setDetail(data))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [advertId]);

  useEffect(() => {
    // Escape closes; the page behind must not scroll while the sheet is up.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    addEventListener('keydown', onKey);
    dialogRef.current?.focus();

    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const heading = detail?.title || 'Loading…';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        ref={dialogRef}
        // The backdrop closes on click; the sheet itself must not.
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div className="modal-heading">
            <strong>{heading}</strong>
            {detail?.subTitle && <div className="tiny muted">{detail.subTitle}</div>}
          </div>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="modal-body">
          {error && (
            <div className="banner">
              {error}
              <div className="tiny" style={{ marginTop: 6 }}>
                <a href={`https://www.autotrader.co.uk/car-details/${advertId}`} target="_blank" rel="noreferrer">
                  Open on AutoTrader
                </a>
              </div>
            </div>
          )}

          {!detail && !error && <div className="modal-loading muted small">Loading advert…</div>}

          {detail && (
            <>
              <Gallery images={detail.images} alt={detail.title} />

              <div className="modal-price spread">
                <span className="price">{detail.priceLabel ?? '—'}</span>
                {detail.priceIndicator && (
                  <span className={`badge ${priceTone(detail.priceIndicator)}`}>
                    {PRICE_LABELS[detail.priceIndicator]}
                  </span>
                )}
              </div>

              {detail.attentionGrabber && <p className="small">{detail.attentionGrabber}</p>}

              <div className="specs">
                {detail.pills.map((pill) => (
                  <span key={pill} className="badge">
                    {pill}
                  </span>
                ))}
              </div>

              <div className="badges">
                {detail.serviceHistory && (
                  <span className={`badge ${serviceTone(detail.serviceHistory)}`}>
                    {SERVICE_LABELS[detail.serviceHistory]}
                    {detail.lastServiceDate ? ` · ${detail.lastServiceDate}` : ''}
                  </span>
                )}
                {detail.motLabel && (
                  // Their value sometimes already says "MOT" ("12 months MOT
                  // included"), so only prefix when it doesn't.
                  <span className="badge">
                    {/MOT/i.test(detail.motLabel) ? detail.motLabel : `MOT ${detail.motLabel}`}
                  </span>
                )}
              </div>

              {detail.keySpecs.length > 0 && (
                <Section title="Overview" count={detail.keySpecs.length} defaultOpen>
                  <dl className="kv">
                    {detail.keySpecs.map((spec) => (
                      <div key={spec.label}>
                        <dt>{spec.label}</dt>
                        <dd>{spec.value}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              )}

              {detail.description.length > 0 && (
                <Section title="Seller's description">
                  {detail.description.map((paragraph, i) => (
                    <p key={i} className="small">
                      {paragraph}
                    </p>
                  ))}
                </Section>
              )}

              {detail.specs.length > 0 && (
                <Section title="Specification" count={detail.specs.reduce((n, g) => n + g.items.length, 0)}>
                  {detail.specs.map((group) => (
                    <div key={group.category}>
                      <h4 className="small">{group.category}</h4>
                      <dl className="kv">
                        {group.items.map((item) => (
                          <div key={item.name}>
                            <dt>{item.name}</dt>
                            <dd>{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </Section>
              )}

              {detail.features.length > 0 && (
                <Section title="Features" count={detail.features.reduce((n, g) => n + g.items.length, 0)}>
                  {detail.features.map((group) => (
                    <div key={group.category}>
                      <h4 className="small">{group.category}</h4>
                      <ul className="feature-list small">
                        {group.items.map((item) => (
                          <li key={item.name}>
                            {item.name}
                            {/* Optional extras are what the seller paid more for. */}
                            {item.type && item.type !== 'Standard' && (
                              <span className="tiny muted"> · {item.type}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </Section>
              )}

              {(detail.checks.length > 0 || detail.sellerName) && (
                <Section title="History and seller">
                  {detail.checks.length > 0 && (
                    <div className="badges" style={{ marginBottom: 10 }}>
                      {detail.checks.map((check) => (
                        <span
                          key={check.id}
                          className={`badge ${check.status === 'FAILED' ? 'bad' : check.status === 'PASSED' ? 'good' : 'warn'}`}
                        >
                          {check.label}: {check.status === 'PASSED' ? 'clear' : check.status.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="small">
                    {detail.sellerName ?? 'Private seller'}
                    {detail.sellerLocation ? ` · ${detail.sellerLocation}` : ''}
                  </div>
                  {detail.sellerPhone && <div className="small">{detail.sellerPhone}</div>}
                </Section>
              )}

              <div className="row">
                <a className="btn" href={detail.detailUrl} target="_blank" rel="noreferrer">
                  View on AutoTrader
                  <ExternalLink size={16} aria-hidden="true" />
                </a>
                <CopyButton value={detail.detailUrl} label="Copy link" copiedLabel="Copied ✓" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
