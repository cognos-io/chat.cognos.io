import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// The blog's behaviour, not its styling: routing, the six locales, the
// slideshow and the lightbox. The two widgets are progressive enhancement, so
// each is checked for the thing that actually matters to a keyboard or screen
// reader user rather than for a class name.

const POST = '/blog/shared-ai-chats-are-public-web-pages';

test.describe('blog index', () => {
  test('lists the post and links to it', async ({ page }) => {
    await page.goto('/blog');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Notes on private AI',
    );

    const card = page.getByRole('link', {
      name: /Your shared AI chat is a public web page/,
    });
    await expect(card).toBeVisible();

    await card.click();
    await expect(page).toHaveURL(new RegExp(`${POST}/?$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Your shared AI chat is a public web page',
    );
  });

  test('is reachable from the navbar', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('nav.navbar')
      .getByRole('link', { name: 'Blog', exact: true })
      .click();
    await expect(page).toHaveURL(/\/blog\/?$/);
  });

  test('advertises a per-locale feed', async ({ page, request }) => {
    await page.goto('/de/blog');
    await expect(
      page.locator('link[rel="alternate"][type="application/rss+xml"]'),
    ).toHaveAttribute('href', '/de/blog/rss.xml');

    const feed = await request.get('/de/blog/rss.xml');
    expect(feed.ok()).toBeTruthy();
    const xml = await feed.text();
    expect(xml).toContain('<language>de-ch</language>');
    expect(xml).toContain('Dein geteilter KI-Chat ist eine öffentliche Webseite');
  });
});

test.describe('blog post', () => {
  test('renders the article in the requested locale', async ({ page }) => {
    await page.goto(`/de${POST}`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Dein geteilter KI-Chat ist eine öffentliche Webseite',
    );
    // The byline carries the untranslated personal name and a translated role.
    await expect(page.getByText('Ewan Jones')).toBeVisible();
    await expect(page.getByText('Gründer, Cognos')).toBeVisible();
    // Dates are formatted for the locale, not hard-coded English.
    await expect(page.locator('time[datetime="2026-07-28"]').first()).toContainText(
      'Juli 2026',
    );

    // `useTranslations` falls back to English for any key a locale is missing,
    // which makes a dropped catalogue subtree look like a styling problem rather
    // than a failure. These are the strings that went English when the German
    // `blog.*` subtree was lost, so they are pinned per-locale here.
    await expect(page.getByText('5 Min. Lesezeit')).toBeVisible();
    await expect(page.locator('.blog-breadcrumb')).toContainText('Privatsphäre');
    await expect(page.locator('body')).not.toContainText('5 min read');
    await expect(page.locator('body')).not.toContainText('Founder, Cognos');
  });

  test('renders every image it references', async ({ page }) => {
    await page.goto(POST);

    // Trigger the lazily-loaded gallery images, then wait for the browser to
    // finish with all of them.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() =>
      Array.from(document.images).every((i) => i.complete),
    );

    // naturalWidth === 0 on a completed image means it failed to decode - a
    // missing file, a wrong path, or malformed SVG (an XML comment containing
    // "--" once broke the hero this way). The lightbox's placeholder carries no
    // src until an image is opened, so it is not a candidate.
    const broken = await page.evaluate(() =>
      Array.from(document.images)
        .filter((i) => i.getAttribute('src') && i.naturalWidth === 0)
        .map((i) => i.currentSrc || i.src),
    );
    expect(broken).toEqual([]);

    // An empty src resolves against the document, so the page fetches itself as
    // an image. Never ship one.
    const emptySrc = await page.evaluate(
      () =>
        Array.from(document.images).filter((i) => i.getAttribute('src') === '').length,
    );
    expect(emptySrc).toBe(0);
  });

  test('marks itself up as an article for shares', async ({ page }) => {
    await page.goto(POST);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      'content',
      'article',
    );
    await expect(page.locator('meta[property="article:author"]')).toHaveAttribute(
      'content',
      'Ewan Jones',
    );
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto(POST);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('slideshow', () => {
  test('steps through slides and tracks the position', async ({ page }) => {
    await page.goto(POST);

    const slides = page.getByRole('group', { name: /^1 of 3$/ });
    await expect(slides).toBeVisible();

    // The controls only appear once the enhancing script has run.
    const next = page.getByRole('button', { name: 'Next slide' });
    const previous = page.getByRole('button', { name: 'Previous slide' });
    await expect(next).toBeVisible();
    await expect(previous).toBeDisabled();

    const secondDot = page.getByRole('button', { name: 'Show image 2 of 3' });
    await expect(secondDot).toHaveAttribute('aria-current', 'false');

    await next.click();
    await expect(secondDot).toHaveAttribute('aria-current', 'true');
    await expect(previous).toBeEnabled();

    // A slide change moves no focus, so it must be announced instead.
    await expect(page.locator('[data-slideshow-status]')).toHaveText('Image 2 of 3');

    await next.click();
    await expect(next).toBeDisabled();
  });

  test('pans with the arrow keys', async ({ page }) => {
    await page.goto(POST);

    // The scrollable strip is focusable and named by the gallery's own label,
    // so a keyboard user can reach and pan it.
    await page
      .getByRole('group', { name: /^How a shared conversation is exposed/ })
      .focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-slideshow-status]')).toHaveText('Image 2 of 3');

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-slideshow-status]')).toHaveText('Image 1 of 3');
  });
});

test.describe('lightbox', () => {
  test('opens an image, browses the set and restores focus on close', async ({
    page,
  }) => {
    await page.goto(POST);

    const trigger = page.getByRole('button', { name: /^Enlarge image: Three steps/ });
    await trigger.click();

    const viewer = page.getByRole('dialog', { name: 'Image viewer' });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-lightbox-counter]')).toHaveText('1 of 3');
    // At the first image there is nowhere back to go.
    await expect(page.getByRole('button', { name: 'Previous image' })).toBeDisabled();

    await page.keyboard.press('ArrowRight');
    await expect(viewer.locator('[data-lightbox-counter]')).toHaveText('2 of 3');

    // Slide 2's caption is the one carrying inline markup. Captions are cloned
    // from the figcaption rather than copied as text, so `<code>` renders as an
    // element and never as literal tags.
    const caption = viewer.locator('[data-lightbox-caption]');
    await expect(caption.locator('code')).toHaveText('#');
    await expect(caption).not.toContainText('<code>');

    await page.getByRole('button', { name: 'Next image' }).click();
    await expect(viewer.locator('[data-lightbox-counter]')).toHaveText('3 of 3');
    await expect(page.getByRole('button', { name: 'Next image' })).toBeDisabled();

    // Escape is the native dialog behaviour we rely on instead of a custom trap.
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("labels its controls in the reader's language", async ({ page }) => {
    await page.goto(`/fr${POST}`);

    await page
      .getByRole('button', { name: /^Agrandir l'image : Trois étapes/ })
      .click();
    await expect(
      page.getByRole('dialog', { name: "Visionneuse d'images" }),
    ).toBeVisible();
    await expect(page.locator('[data-lightbox-counter]')).toHaveText('1 sur 3');
    await expect(
      page.getByRole('button', { name: "Fermer la visionneuse d'images" }),
    ).toBeVisible();
  });
});
