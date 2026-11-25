/** Capture screenshots and accessible structure from the production preview. */
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const directory = new URL('./preflight/', import.meta.url);
const base = `http://127.0.0.1:${process.env.PREVIEW_PORT || 4173}`;
await mkdir(directory, {recursive: true});
const browser = await chromium.launch({channel: 'chromium'});
const results = [];

/** Record visible structure, current typography and page overflow for review. */
async function capture(page, label) {
  await page.screenshot({path: new URL(`${label}.png`, directory).pathname});
  const styles = await page.evaluate(() => ({
    font: getComputedStyle(document.body).fontFamily,
    color: getComputedStyle(document.body).color,
    background: getComputedStyle(document.body).backgroundColor,
    viewport: innerWidth,
    actualWidth: document.documentElement.scrollWidth,
  }));
  const tree = await page.locator('body').ariaSnapshot();
  results.push({label, styles, tree});
  await writeFile(new URL(`${label}.html`, directory), await page.content());
}

try {
  for (const [label, viewport] of Object.entries({desktop: {width: 1366, height: 768}, mobile: {width: 390, height: 844}})) {
    const page = await browser.newPage({viewport});
    await page.goto(`${base}/login`);
    await page.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    await capture(page, `${label}-login`);
    await page.getByRole('button', {name: /continue.*marcus hale/i}).click();
    await page.getByRole('heading', {name: 'West Metro Cluster 4', exact: true}).waitFor();
    await capture(page, `${label}-portfolio`);
    await page.getByRole('link', {name: 'Review Harbor Point'}).click();
    await page.getByRole('tab', {name: 'Prediction'}).click();
    await capture(page, `${label}-prediction`);
    await page.close();
  }
} finally {
  await writeFile(new URL('preflight.txt', directory), JSON.stringify(results, null, 2));
  await browser.close();
}
