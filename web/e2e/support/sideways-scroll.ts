import { expect, type Page } from '@playwright/test';

/** One element whose content is wider than its box and that can scroll. */
export interface SidewaysOverflow {
  /** Tag, role and class of the element, enough to find it in the code. */
  element: string;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * Lists what scrolls sideways on the page now: the page itself and every
 * scroll container (overflow auto or scroll) with `scrollWidth` above
 * `clientWidth`. Text fields scroll their own text and `.hrow` is the
 * design's deliberate swipeable chip row, so neither counts. Truncated text
 * (overflow hidden) is not a scroll container and is left alone.
 */
export async function findSidewaysOverflows(
  page: Page,
): Promise<SidewaysOverflow[]> {
  return page.evaluate(() => {
    const found: SidewaysOverflow[] = [];
    const describe = (element: Element) =>
      [
        element.tagName.toLowerCase(),
        element.getAttribute('role') ? `[${element.getAttribute('role')}]` : '',
        element.className && typeof element.className === 'string'
          ? `.${element.className.trim().split(/\s+/).join('.')}`
          : '',
      ].join('');
    const record = (element: Element) =>
      found.push({
        element: describe(element),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      });
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) record(root);
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      if (element.matches('input, textarea, select, .hrow')) continue;
      const { overflowX } = getComputedStyle(element);
      if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
      if (element.scrollWidth > element.clientWidth) record(element);
    }
    return found;
  });
}

/**
 * Fails when the page, a sheet or a screen scrolls sideways. Call it with
 * the sheet or screen on show; `what` names it in the failure message.
 */
export async function expectNoSidewaysScroll(
  page: Page,
  what: string,
): Promise<void> {
  expect
    .soft(await findSidewaysOverflows(page), `${what} scrolls sideways`)
    .toEqual([]);
}
