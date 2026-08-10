import { useState } from 'react';
import type { ResultListing } from './api';
import { expandImageUrl } from '../../src/autotrader/fullDetail';
import {
  miles,
  money,
  PRICE_LABELS,
  priceTone,
  relativeTime,
  SERVICE_LABELS,
  serviceTone,
} from './format';

export function ResultCard({
  listing,
  onToggleStar,
  onSetVrm,
  onOpen,
}: {
  listing: ResultListing;
  onToggleStar: (advertId: string, starred: boolean) => void;
  onSetVrm: (advertId: string, vrm: string) => void;
  onOpen: (advertId: string) => void;
}) {
  const [vrmDraft, setVrmDraft] = useState(listing.vrm ?? '');

  const enriched = listing.detailFetchedAt !== null;

  return (
    <article className={`card listing${listing.isNew ? ' is-new' : ''}`}>
      <div className="listing-head">
        {/* Photo and title both open the full advert — the link out to
            AutoTrader lives inside the modal, so the card has one action. */}
        {listing.imageUrl && (
          <button
            type="button"
            className="listing-thumb-button"
            aria-label={`View all photos and details for ${listing.title}`}
            onClick={() => onOpen(listing.advertId)}
          >
            {/* Search images carry AutoTrader's {resize} token; older rows
                stored an already-sized URL, which passes through unchanged. */}
            <img
              className="listing-thumb"
              src={expandImageUrl(listing.imageUrl, 240)}
              alt=""
              loading="lazy"
            />
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="listing-title">
            <button type="button" className="listing-title-button" onClick={() => onOpen(listing.advertId)}>
              {listing.year ? `${listing.year} ` : ''}
              {listing.title}
            </button>
          </div>
          <div className="listing-sub">{listing.subTitle}</div>
        </div>
        <button
          type="button"
          className="icon"
          aria-label={listing.starred ? 'Remove from shortlist' : 'Add to shortlist'}
          aria-pressed={listing.starred}
          onClick={() => onToggleStar(listing.advertId, !listing.starred)}
        >
          {listing.starred ? '★' : '☆'}
        </button>
      </div>

      <div className="spread">
        <div>
          <span className="price">{money(listing.price)}</span>
          {listing.priceDrop !== null && (
            <span className="price-was">{money(listing.previousPrice)}</span>
          )}
        </div>
        <div className="badges">
          {listing.isNew && <span className="badge new">New</span>}
          {listing.priceDrop !== null && (
            <span className="badge good">↓ {money(listing.priceDrop)}</span>
          )}
        </div>
      </div>

      <div className="specs">
        <span className="badge">{miles(listing.mileage)}</span>
        {listing.plateReg && <span className="badge">{listing.plateReg} reg</span>}
        {listing.engineLitres && <span className="badge">{listing.engineLitres}L</span>}
        {listing.transmission && <span className="badge">{listing.transmission}</span>}
        {listing.fuel && <span className="badge">{listing.fuel}</span>}
      </div>

      <div className="badges">
        {listing.priceIndicator && listing.priceIndicator !== 'NOANALYSIS' && (
          <span className={`badge ${priceTone(listing.priceIndicator)}`}>
            {PRICE_LABELS[listing.priceIndicator]}
          </span>
        )}
        {listing.serviceHistory && (
          <span className={`badge ${serviceTone(listing.serviceHistory)}`}>
            {SERVICE_LABELS[listing.serviceHistory]}
            {listing.lastServiceDate ? ` · ${listing.lastServiceDate}` : ''}
          </span>
        )}
        {/* Only PASSED is reassuring. UNKNOWN means AutoTrader published no
            check at all, which is not the same as "clean". */}
        {listing.writeOff === 'FAILED' && <span className="badge bad">Written off</span>}
        {listing.writeOff === 'UNKNOWN' && enriched && (
          <span className="badge warn">Write-off status unknown</span>
        )}
        {listing.imported === 'FAILED' && <span className="badge warn">Imported</span>}
        {listing.stolen === 'FAILED' && <span className="badge bad">Recorded stolen</span>}
        {listing.scrapped === 'FAILED' && <span className="badge bad">Recorded scrapped</span>}
        {listing.motStatus && <span className="badge">{listing.motStatus}</span>}
      </div>

      <div className="badges">
        {listing.matchedCombos.map((label) => (
          <span key={label} className="badge combo">
            {label}
          </span>
        ))}
      </div>

      <div className="spread tiny muted">
        <span>
          {listing.sellerName ?? listing.sellerType ?? 'Seller unknown'}
          {listing.location ? ` · ${listing.location}` : ''}
        </span>
        <span>seen {relativeTime(listing.firstSeenAt)}</span>
      </div>

      {!enriched && (
        <div className="tiny muted">Details still queued — service history follows shortly.</div>
      )}

      {listing.starred && (
        <div className="row">
          <input
            value={vrmDraft}
            placeholder="Reg plate for MOT history"
            aria-label="Registration plate"
            onChange={(e) => setVrmDraft(e.target.value)}
            style={{ flex: 1, minWidth: 140 }}
          />
          <button
            type="button"
            onClick={() => onSetVrm(listing.advertId, vrmDraft)}
            disabled={!vrmDraft.trim() || vrmDraft.trim().toUpperCase() === listing.vrm}
          >
            Save
          </button>
        </div>
      )}
    </article>
  );
}
