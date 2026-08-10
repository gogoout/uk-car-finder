import { useEffect, useMemo, useRef, useState } from 'react';
import { expandImageUrl, type GalleryImage } from '../../src/autotrader/fullDetail';

/** Wide enough for a retina phone without pulling full-resolution originals. */
const MAIN_WIDTH = 800;
const THUMB_WIDTH = 160;

/**
 * Photo viewer for the detail modal: one large image, swipe or arrows to move,
 * a counter, a thumbnail strip, and chips to jump to Interior or Exterior.
 */
export function Gallery({ images, alt }: { images: GalleryImage[]; alt: string }) {
  const [category, setCategory] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const image of images) {
      if (image.category && !seen.includes(image.category)) seen.push(image.category);
    }
    return seen;
  }, [images]);

  const visible = useMemo(
    () => (category ? images.filter((i) => i.category === category) : images),
    [images, category],
  );

  // Filtering can leave the index past the end of the shorter list.
  useEffect(() => setIndex(0), [category]);

  const count = visible.length;
  const current = visible[Math.min(index, count - 1)];

  const step = (delta: number) => {
    if (count === 0) return;
    // Wrap, so the arrows never dead-end at either extreme.
    setIndex((i) => (i + delta + count) % count);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  // Keep the active thumbnail in view when moving with arrows or swipes.
  useEffect(() => {
    stripRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index, category]);

  if (count === 0 || !current) {
    return <div className="gallery-empty muted small">No photos on this advert</div>;
  }

  return (
    <div className="gallery">
      <div
        className="gallery-main"
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchStartX.current;
          const end = e.changedTouches[0]?.clientX;
          touchStartX.current = null;
          if (start === null || end === undefined) return;
          // Ignore small movements so a tap or vertical scroll isn't a swipe.
          if (Math.abs(end - start) > 40) step(end < start ? 1 : -1);
        }}
      >
        <img
          src={expandImageUrl(current.url, MAIN_WIDTH)}
          alt={current.label ? `${alt} — ${current.label}` : alt}
        />

        {count > 1 && (
          <>
            <button type="button" className="gallery-nav prev" aria-label="Previous photo" onClick={() => step(-1)}>
              ‹
            </button>
            <button type="button" className="gallery-nav next" aria-label="Next photo" onClick={() => step(1)}>
              ›
            </button>
          </>
        )}

        <span className="gallery-counter tiny">
          {Math.min(index, count - 1) + 1} / {count}
        </span>
        {current.label && <span className="gallery-tag tiny">{current.label}</span>}
      </div>

      {categories.length > 1 && (
        <div className="row gallery-chips">
          <button
            type="button"
            className={`chip${category === null ? ' is-active' : ''}`}
            onClick={() => setCategory(null)}
          >
            All ({images.length})
          </button>
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className={`chip${category === name ? ' is-active' : ''}`}
              onClick={() => setCategory(name)}
            >
              {name} ({images.filter((i) => i.category === name).length})
            </button>
          ))}
        </div>
      )}

      <div className="gallery-strip" ref={stripRef}>
        {visible.map((image, i) => (
          <button
            key={`${image.url}-${i}`}
            type="button"
            data-active={i === Math.min(index, count - 1)}
            className={`gallery-thumb${i === Math.min(index, count - 1) ? ' is-active' : ''}`}
            aria-label={`Photo ${i + 1}${image.label ? `, ${image.label}` : ''}`}
            onClick={() => setIndex(i)}
          >
            <img src={expandImageUrl(image.url, THUMB_WIDTH)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
