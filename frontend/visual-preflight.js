/** Capture screenshots and accessible structure from the production preview. */
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const directory = new URL('./preflight/', import.meta.url);
const base = `http://127.0.0.1:${process.env.PREVIEW_PORT || 4173}`;
await mkdir(directory, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const results = [];
const zoomLimitation = 'Native browser zoom was not exercised. The 200% profile uses a half-size CSS viewport and deviceScaleFactor 2 as a reflow proxy.';

/** Record visible structure, computed palette and layout for review. */
async function capture(page, label, limitation) {
  await page.screenshot({path: new URL(`${label}.png`, directory).pathname, fullPage: true});
  const styles = await page.evaluate(() => {
    const palette = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const {color, backgroundColor} = getComputedStyle(element);
      return {color, backgroundColor};
    };
    const box = element => {
      const {x, y, width, height} = element.getBoundingClientRect();
      return {x, y, width, height};
    };
    const form = document.querySelector('main form:has(#login-email)');
    const roster = form?.parentElement.querySelector('ul');
    return {
      font: getComputedStyle(document.body).fontFamily,
      color: getComputedStyle(document.body).color,
      background: getComputedStyle(document.body).backgroundColor,
      viewport: innerWidth,
      viewportHeight: innerHeight,
      devicePixelRatio,
      actualWidth: document.documentElement.scrollWidth,
      header: palette('header.shell-header'),
      footer: palette('footer'),
      footerText: document.querySelector('footer')?.innerText ?? null,
      primaryAction: palette('main .btn-primary'),
      selectedNav: palette('nav [aria-current]'),
      signInLayout: form && roster ? {form: box(form), roster: box(roster)} : null,
    };
  });
  const tree = await page.locator('body').ariaSnapshot();
  results.push({label, ...(limitation && {limitation}), styles, tree});
  await writeFile(new URL(`${label}.html`, directory), await page.content());
}

try {
  const desktop = {width: 1366, height: 768};
  const profiles = {
    desktop: {viewport: desktop},
    mobile: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true},
    tablet: {viewport: {width: 768, height: 1024}, isMobile: true, hasTouch: true},
    // Half the desktop CSS viewport models 200% layout reflow, not the browser's zoom setting.
    'zoom-200-reflow': {viewport: {width: desktop.width / 2, height: desktop.height / 2}, deviceScaleFactor: 2},
  };
  for (const [label, options] of Object.entries(profiles)) {
    const page = await browser.newPage(options);
    const limitation = label === 'zoom-200-reflow' ? zoomLimitation : undefined;
    await page.goto(`${base}/login`);
    await page.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    await capture(page, `${label}-login`, limitation);
    await page.getByRole('button', {name: 'Continue as Marcus Hale', exact: true}).click();
    const main = page.getByRole('main');
    await main.getByRole('heading', {name: 'Programs', exact: true, level: 1}).waitFor();
    await capture(page, `${label}-portfolio`, limitation);
    await main.getByRole('link', {name: 'Open West Metro Cluster 4', exact: true}).click();
    await main.getByRole('heading', {name: 'West Metro Cluster 4', exact: true, level: 1}).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, `${label}-board`, limitation);
    await main.getByRole('link', {name: 'Review Harbor Point', exact: true}).click();
    await main.getByRole('tab', {name: 'Prediction', exact: true}).click();
    await main.getByRole('tabpanel', {name: 'Prediction', exact: true}).getByRole('heading', {name: 'Readiness probability', exact: true}).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, `${label}-prediction`, limitation);
    await page.close();
  }
} finally {
  await writeFile(new URL('preflight.txt', directory), JSON.stringify(results, null, 2));
  await browser.close();
}
