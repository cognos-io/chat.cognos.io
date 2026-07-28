import { expect, test } from '@playwright/test';

// The markdown twins and llms.txt as an agent actually meets them: over HTTP,
// with whatever the server says they are. `scripts/check-llms.mjs` already
// checks every file's contents at build time, so this suite covers the things
// only a request can show - status, content type, and the discovery path from
// an HTML page to its markdown.

test.describe('markdown twins', () => {
  test('a page and its twin carry the same words', async ({ page, request }) => {
    await page.goto('/docs/account-key');
    const heading = await page.getByRole('heading', { level: 1 }).textContent();

    const response = await request.get('/docs/account-key.md');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain(`# ${heading?.trim()}`);
    expect(body).toContain('source: "https://cognos.io/docs/account-key"');
    // The twin is prose, not markup.
    expect(body).not.toMatch(/<\/?[a-z][a-z0-9]*(\s[^<>]*)?>/i);
  });

  test('the twin is served as markdown, not as a download', async ({ request }) => {
    const response = await request.get('/terms.md');
    expect(response.status()).toBe(200);

    const type = response.headers()['content-type'] ?? '';
    // Either is fine for an agent; `application/octet-stream` is not, because a
    // browser then downloads the file instead of showing it. Bunny serves these
    // files in production, so this pins what the extension must map to.
    expect(type).toMatch(/^text\/(markdown|plain)/);
  });

  test('every page advertises its twin from the HTML head', async ({ page }) => {
    await page.goto('/privacy');
    const href = await page
      .locator('link[rel="alternate"][type="text/markdown"]')
      .getAttribute('href');
    expect(href).toBe('https://cognos.io/privacy.md');
  });

  test('a prefixed locale gets its own twin, in its own language', async ({
    request,
  }) => {
    const response = await request.get('/de/docs/account-key.md');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('locale: "de-CH"');
    expect(body).toContain('source: "https://cognos.io/de/docs/account-key"');
    // Links inside the German twin stay in German.
    expect(body).toContain('https://cognos.io/de/docs/');
    // Swiss orthography, as everywhere else in the German catalogue.
    expect(body).not.toContain('ß');
  });
});

test.describe('llms.txt', () => {
  test('follows the spec and links to files that exist', async ({ request }) => {
    const response = await request.get('/llms.txt');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body.startsWith('# Cognos')).toBe(true);
    expect(body).toMatch(/^> \S/m);
    expect(body).toContain('## Docs');
    expect(body).toContain('## Optional');

    const links = [...body.matchAll(/\]\((https:\/\/cognos\.io[^)]+\.md)\)/g)].map(
      (match) => match[1],
    );
    expect(links.length).toBeGreaterThan(40);

    // Fetching all 51 would just re-check the build script; a spread across the
    // groups is enough to prove the URL shape is right over HTTP.
    for (const url of [links[0], links[5], links.at(-1)!]) {
      const page = await request.get(url.replace('https://cognos.io', ''));
      expect(page.status(), `${url} should resolve`).toBe(200);
    }
  });

  test('each locale has its own index', async ({ request }) => {
    const response = await request.get('/de/llms.txt');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('Deutsch (de-CH)');
    expect(body).toContain('https://cognos.io/de/');
    expect(body).not.toMatch(/\]\(https:\/\/cognos\.io\/(fr|es|pt|it)\/[^)]+\.md\)/);
  });

  test('the whole site is available in one file', async ({ request }) => {
    const response = await request.get('/llms-full.txt');
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body.length).toBeGreaterThan(50_000);
    // Concatenated pages are separated by horizontal rules, each keeping its
    // own front matter so a fragment still names its source.
    expect(body.split('\n---\n\n').length).toBeGreaterThan(40);
    expect(body).toContain('# Your Account Key');
  });
});
