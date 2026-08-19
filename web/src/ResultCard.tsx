import type { ResultListing } from './api';
import { expandImageUrl } from '../../src/autotrader/fullDetail';
import { Star, Trash2, Undo2 } from 'lucide-react';
import {
  miles,
  money,
  monthYear,
  PRICE_LABELS,
  priceTone,
  relativeTime,
  SERVICE_LABELS,
  serviceTone,
} from './format';

export function ResultCard({
  listing,
  onToggleStar,
  onOpen,
  onDiscard,
}: {
  listing: ResultListing;
  onToggleStar: (advertId: string, starred: boolean) => void;
  onOpen: (advertId: string) => void;
  onDiscard: (advertId: string, discarded: boolean) => void;
}) {
  const enriched = listing.detailFetchedAt !== null;
  const mot = listing.motSummary;

  return (
    <article
      className={`card listing${listing.isNew ? ' is-new' : ''}${listing.discarded ? ' is-discarded' : ''}`}
    >
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
        <div className="listing-actions">
          <button
            type="button"
            className="icon"
            aria-label={listing.starred ? 'Remove from shortlist' : 'Add to shortlist'}
            aria-pressed={listing.starred}
            onClick={() => onToggleStar(listing.advertId, !listing.starred)}
          >
            <Star size={18} aria-hidden="true" fill={listing.starred ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="icon"
            aria-label={listing.discarded ? 'Restore this car' : 'Discard this car'}
            onClick={() => onDiscard(listing.advertId, !listing.discarded)}
          >
            {/* A bin, not a cross: a cross is what closes things, and this
                rules a car out. */}
            {listing.discarded ? (
              <Undo2 size={18} aria-hidden="true" />
            ) : (
              <Trash2 size={18} aria-hidden="true" />
            )}
          </button>
        </div>
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
        {/* Solid = AutoTrader's provenance check says so. Dashed = only the
            seller's own words say so, shown when they publish no check. Same
            colour because it is the same claim; different border because the
            evidence is much weaker. */}
        {listing.imported === 'FAILED' && <span className="badge warn">Imported</span>}
        {listing.imported !== 'FAILED' && listing.importMentioned && (
          <span className="badge warn is-suspected" title="The advert text mentions an import; AutoTrader published no vehicle check for this car">
            Imported?
          </span>
        )}
        {listing.stolen === 'FAILED' && <span className="badge bad">Recorded stolen</span>}
        {listing.scrapped === 'FAILED' && <span className="badge bad">Recorded scrapped</span>}
        {listing.motStatus && <span className="badge">{listing.motStatus}</span>}
      </div>

      {/* Only present once you have entered a plate. The two warnings are the
          reason for looking one up: an odometer that goes backwards, and an
          advertised mileage the last MOT contradicts. */}
      {mot && (
        <div className="badges">
          {mot.possibleClocking && <span className="badge bad">Possible clocking</span>}
          {mot.mileageMismatch !== null && (
            <span
              className="badge bad"
              title={`Last MOT read ${miles(mot.latestOdometer)}; the advert says ${miles(listing.mileage)}`}
            >
              MOT reads {miles(mot.mileageMismatch)} more
            </span>
          )}
          {mot.plateMismatch && (
            <span className="badge warn" title={`DVSA has this plate as a ${mot.plateMismatch}`}>
              Plate mismatch
            </span>
          )}
          {mot.expiryDate && (
            <span className="badge">MOT to {monthYear(mot.expiryDate)}</span>
          )}
        </div>
      )}

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

    </article>
  );
}
