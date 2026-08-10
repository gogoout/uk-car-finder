import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractAdvert } from '../src/autotrader/detail';
import { minimiseDetailPage } from '../scripts/capture-fixture';

const DIR = join(import.meta.dirname, 'fixtures');
const htmlFixtures = readdirSync(DIR).filter((f) => f.endsWith('.html'));

/**
 * A full AutoTrader page embeds their own Google Maps API key in
 * `AT_SPA_JS_CONFIG`. Committing whole pages republished it and tripped GitHub
 * secret scanning, so fixtures are now trimmed to the hydration payload alone.
 * These tests keep it that way.
 */
describe('captured fixtures', () => {
  it('has fixtures to check', () => {
    expect(htmlFixtures.length).toBeGreaterThan(0);
  });

  it.each(htmlFixtures)('%s contains no key-like strings', (name) => {
    const content = readFileSync(join(DIR, name), 'utf8');
    const found = content.match(/AIza[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}/);
    expect(found?.[0]).toBeUndefined();
  });

  it.each(htmlFixtures)('%s carries only the hydration payload', (name) => {
    const content = readFileSync(join(DIR, name), 'utf8');

    // A full page pulls in adverts, trackers and third-party config; the
    // trimmed capture has exactly one script.
    expect(content.match(/<script/g)?.length).toBe(1);
    expect(content).not.toContain('AT_SPA_JS_CONFIG');
    expect(content).not.toContain('googleMapsApiKey');
    expect(statSync(join(DIR, name)).size).toBeLessThan(120 * 1024);
  });

  it.each(htmlFixtures)('%s is still parseable', (name) => {
    expect(() => extractAdvert(readFileSync(join(DIR, name), 'utf8'))).not.toThrow();
  });
});

describe('minimiseDetailPage', () => {
  it('drops the config script that carries the API key', () => {
    const page = [
      '<html><head>',
      `<script>window['AT_SPA_JS_CONFIG'] = JSON.parse('{"googleMapsApiKey":"AIzaSyFAKEKEYFAKEKEYFAKEKEY123"}');</script>`,
      '<script>window.__staticRouterHydrationData = JSON.parse("{\\"loaderData\\":{}}");</script>',
      '</head><body>ads and trackers</body></html>',
    ].join('\n');

    const minimal = minimiseDetailPage(page, '123');

    expect(minimal).not.toContain('AIzaSy');
    expect(minimal).not.toContain('googleMapsApiKey');
    expect(minimal).not.toContain('ads and trackers');
    expect(minimal).toContain('__staticRouterHydrationData');
  });

  it('throws rather than write an unusable fixture', () => {
    expect(() => minimiseDetailPage('<html>nothing here</html>', '123')).toThrow(
      /No __staticRouterHydrationData/,
    );
  });
});
