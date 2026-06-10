/**
 * Test: githubExtractor.extract() pulls release notes from BOTH the modern
 * GitHub release DOM (no .release-header/.release-body wrappers) and the
 * legacy DOM. Regression guard for the "extension sees no text on a release
 * page" bug.
 *
 * Run: node --experimental-strip-types scripts/test-github-release.mjs
 */
import { JSDOM } from 'jsdom';

const RELEASE_URL = 'https://github.com/microsoft/PowerToys/releases/tag/v0.100.0';

// --- Modern DOM (captured from the live page, 2026-06) ----------------------
// Key shape: no .release-header / .release-body. Title is a bare <h1>, the body
// lives in [data-test-selector="body-content"].markdown-body, author/date sit
// loose next to "released this".
const MODERN_HTML = `<!DOCTYPE html><html><head><title>Release Release v0.100.0 · microsoft/PowerToys · GitHub</title></head><body>
  <div class="repository-content">
    <div class="d-flex">
      <h1 data-view-component="true" class="tmp-mr-3 d-inline">Release v0.100.0</h1>
    </div>
    <div class="flex-1">
      <img class="avatar avatar-small circle" />
      <a class="text-bold color-fg-muted" data-hovercard-type="user" href="/LegendaryBlair">LegendaryBlair</a>
      released this
      <relative-time class="no-wrap" datetime="2026-06-10T04:21:04Z">10 Jun 04:21</relative-time>
      <div class="tmp-mr-4 mb-2">
        <a href="/microsoft/PowerToys/tree/v0.100.0" class="Link Link--muted">
          <span class="css-truncate css-truncate-target"> v0.100.0 </span>
        </a>
      </div>
    </div>
    <div data-pjax="true" data-test-selector="body-content" data-view-component="true" class="markdown-body tmp-my-3">
      <h2>Highlights</h2>
      <p>This release adds a brand new <strong>Command Palette</strong> and fixes many bugs.</p>
      <ul><li>New PowerToys Run plugin</li><li>Performance improvements</li></ul>
    </div>
  </div>
</body></html>`;

// --- Legacy DOM (the structure the original extractor was written against) --
const LEGACY_HTML = `<!DOCTYPE html><html><head><title>Release Old Release · owner/repo · GitHub</title></head><body>
  <div class="release-header">
    <h1 class="release-title"><a class="css-truncate-target" href="/owner/repo/releases/tag/v1.0.0">v1.0.0</a></h1>
    <div class="markdown-title">Old Release</div>
    <a class="author" data-hovercard-type="user" href="/octocat">octocat</a>
    <relative-time datetime="2020-01-01T00:00:00Z">Jan 1, 2020</relative-time>
  </div>
  <div class="release-body">
    <div class="markdown-body">
      <h2>Legacy notes</h2>
      <p>This is the legacy release body content.</p>
    </div>
  </div>
</body></html>`;

function setupGlobals(html, url) {
  const dom = new JSDOM(html, { url });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.Element = dom.window.Element;
  globalThis.URL = dom.window.URL ?? URL;
  return dom.window.document;
}

const { githubExtractor } = await import('../src/lib/extractors/github.ts');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('Modern release DOM:');
{
  const doc = setupGlobals(MODERN_HTML, RELEASE_URL);
  check('canExtract matches release URL', githubExtractor.canExtract(RELEASE_URL, doc));
  const r = githubExtractor.extract(RELEASE_URL, doc);
  check('githubPageType is release', r.githubPageType === 'release', r.githubPageType);
  check('body content is captured', /Command Palette/.test(r.content), `content=${JSON.stringify(r.content).slice(0, 200)}`);
  check('release notes heading captured', /Highlights/.test(r.content));
  check('list items captured', /PowerToys Run plugin/.test(r.content));
  check('title is the release title', /Release v0\.100\.0/.test(r.title), `title=${r.title}`);
  check('author captured', r.author === 'LegendaryBlair', `author=${r.author}`);
  check('publishDate captured', r.publishDate === '2026-06-10T04:21:04Z', `date=${r.publishDate}`);
  check('wordCount > 0', r.wordCount > 0, `wordCount=${r.wordCount}`);
}

console.log('Legacy release DOM:');
{
  const url = 'https://github.com/owner/repo/releases/tag/v1.0.0';
  const doc = setupGlobals(LEGACY_HTML, url);
  const r = githubExtractor.extract(url, doc);
  check('legacy body content is captured', /legacy release body content/.test(r.content), `content=${JSON.stringify(r.content).slice(0, 200)}`);
  check('legacy notes heading captured', /Legacy notes/.test(r.content));
  check('legacy author captured', r.author === 'octocat', `author=${r.author}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
