import { type Lang, bcp47, languages, locales } from '../i18n/config';
import { useTranslations } from '../i18n/ui';
import { absoluteUrl, markdownUrl } from './markdown';
import { type MdGroup, type MdRoute, mdRoutes, renderMdRoute } from './md-routes';

// `/llms.txt` and `/llms-full.txt`, per https://llmstxt.org/ - an index of the
// site's markdown twins, and the whole thing in one file.
//
// One pair per locale: `/llms.txt` is English, `/de/llms.txt` German, and each
// links only to its own locale's `.md` files, so an agent that starts from the
// German index stays in German.
//
// The section headings and the framing sentences here are English in every
// locale, deliberately: this file is an index read by machines, and the spec
// names `## Optional` literally. The page *content* it points at is translated.

const groupHeadings: Record<MdGroup, string> = {
  main: 'Main',
  docs: 'Docs',
  legal: 'Legal',
  blog: 'Blog',
};

const groupOrder: MdGroup[] = ['main', 'docs', 'legal', 'blog'];

/** `- [Title](https://…/x.md): one-line description` */
function linkLine(route: MdRoute, lang: Lang): string {
  const t = useTranslations(lang);
  const title = route.title(t).replace(/\s+/g, ' ').trim();
  const note = route.description(t).replace(/\s+/g, ' ').trim();
  return `- [${title}](${markdownUrl(route.path, lang)}): ${note}`;
}

/** The `/llms.txt` index for one locale. */
export function llmsIndex(lang: Lang): string {
  const t = useTranslations(lang);
  const others = locales.filter((other) => other !== lang);

  const parts = [
    '# Cognos',
    `> ${t('meta.description')}`,
    [
      'Cognos is an AI chat app that keeps no copy of your chats it can read, and hides',
      'personal details before a message is sent to an AI provider. Built by Climacrux GmbH',
      'in Switzerland.',
    ].join(' '),
    [
      `Every page below is the markdown version of a page on ${absoluteUrl('/', lang)} -`,
      `append \`.md\` to any page URL to get it. This index covers ${languages[lang]}`,
      `(${bcp47[lang]}); the other five languages are listed at the end.`,
    ].join(' '),
  ];

  for (const group of groupOrder) {
    const routes = mdRoutes.filter((route) => route.group === group);
    if (routes.length === 0) continue;
    parts.push(
      `## ${groupHeadings[group]}\n\n${routes.map((route) => linkLine(route, lang)).join('\n')}`,
    );
  }

  // Per the spec, `## Optional` is what a short-on-context agent skips first -
  // which is exactly right for "the same site in another language".
  parts.push(
    `## Optional\n\n${[
      `- [Everything in one file](${absoluteUrl('/llms-full.txt', lang)}): every page above, concatenated.`,
      ...others.map(
        (other) =>
          `- [Cognos in ${languages[other]}](${absoluteUrl('/llms.txt', other)}): the same site, translated (${bcp47[other]}).`,
      ),
    ].join('\n')}`,
  );

  return `${parts.join('\n\n')}\n`;
}

/**
 * `/llms-full.txt` for one locale: every page's markdown, in `llms.txt` order,
 * separated by horizontal rules. Each page keeps its own front matter, so an
 * agent reading a fragment still knows the title and source URL it came from.
 */
export function llmsFull(lang: Lang): string {
  const t = useTranslations(lang);
  const header = [
    '# Cognos',
    `> ${t('meta.description')}`,
    [
      `Every page of ${absoluteUrl('/', lang)} in one file, ${languages[lang]}`,
      `(${bcp47[lang]}). Each page below starts with its own front matter, including`,
      'the URL it mirrors.',
    ].join(' '),
  ].join('\n\n');

  const pages = mdRoutes.map((route) => renderMdRoute(route, lang).trim());
  return `${[header, ...pages].join('\n\n---\n\n')}\n`;
}
