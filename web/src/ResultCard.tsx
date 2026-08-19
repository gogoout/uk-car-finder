import { useState } from 'react';
import type { ResultListing } from './api';
import { NoteField } from './NoteField';
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
  onToggleStar: (advertId: string, starred: boolean, note?: string | null) => void;
  onOpen: (advertId: string) => void;
  onDiscard: (advertId: string, discarded: boolean, reason?: string | null) => void;
}) {
  const enriched = listing.detailFetchedAt !== null;
  const mot = listing.motSummary;
  const gone = listing.goneAt !== null;
  // Which reason box to open focused, set by the click that just changed the
  // decision — you know why at that moment and nowhere else.
  const [asking, setAsking] = useState<'star' | 'discard' | null>(null);

  return (
    <article
      className={`card listing${listing.isNew ? ' is-new' : ''}${
        listing.discarded || gone ? ' is-discarded' : ''
      }`}
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
            onClick={() => {
              onToggleStar(listing.advertId, !listing.starred);
              setAsking(listing.starred ? null : 'star');
            }}
          >
            <Star size={18} aria-hidden="true" fill={listing.starred ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="icon"
            aria-label={listing.discarded ? 'Restore this car' : 'Discard this car'}
            onClick={() => {
              onDiscard(listing.advertId, !listing.discarded);
              setAsking(listing.discarded ? null : 'discard');
            }}
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
          <span className={gone ? 'price price-gone' : 'price'}>{money(listing.price)}</span>
          {listing.priceDrop !== null && (
            <span className="price-was">{money(listing.previousPrice)}</span>
          )}
        </div>
        <div className="badges">
          {/* AutoTrader still serves a page for a sold car, so this is only
              ever learned by looking — and it is why the advert wouldn't open. */}
          {gone && (
            <span className="badge bad" title={`Not on AutoTrader as of ${relativeTime(listing.goneAt)}`}>
              Sold or gone
            </span>
          )}
          {listing.isNew && !gone && <span className="badge new">New</span>}
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

      {listing.starred && (
        <NoteField
          value={listing.starNote}
          icon={<Star size={11} fill="currentColor" />}
          placeholder="Why shortlisted?"
          startEditing={asking === 'star'}
          onSave={(note) => onToggleStar(listing.advertId, true, note)}
        />
      )}

      {listing.discarded && (
        <NoteField
          value={listing.discardReason}
          icon={<Trash2 size={11} />}
          placeholder="Why ruled out?"
          startEditing={asking === 'discard'}
          onSave={(reason) => onDiscard(listing.advertId, true, reason)}
        />
      )}

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
