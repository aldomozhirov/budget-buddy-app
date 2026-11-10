import { expect, type Locator } from '@playwright/test';

/**
 * Checks that the app's styles keep WebKit's Caps Lock icon in a password
 * field at its 17px size and inside the field's content box.
 *
 * WebKit under Playwright never draws the icon (it follows the real
 * keyboard's Caps Lock), and its computed style can't be read, so this
 * reads the stylesheet rule that applies to the field's icon instead.
 * WebKit's own style stretches the icon to the field's inner height.
 * @param button The show/hide button inside the field, when it has one.
 */
export async function expectCapsLockIconKeepsShape(
  field: Locator,
  button?: Locator,
): Promise<void> {
  const icon = await field.evaluate((input) => {
    const pseudo = '::-webkit-caps-lock-indicator';
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const applies = rule.selectorText
          .split(',')
          .map((selector) => selector.trim())
          .some(
            (selector) =>
              selector.endsWith(pseudo) &&
              input.matches(selector.slice(0, -pseudo.length)),
          );
        if (applies) {
          return {
            alignSelf: rule.style.alignSelf,
            height: rule.style.height,
          };
        }
      }
    }
    return null;
  });
  expect(icon).toEqual({ alignSelf: 'center', height: '17px' });

  if (button) {
    // The icon sits at the end of the content box, left of the padding
    // that leaves room for the button.
    const contentRight = await field.evaluate((input) => {
      const style = getComputedStyle(input);
      return (
        input.getBoundingClientRect().right -
        Number.parseFloat(style.borderRightWidth) -
        Number.parseFloat(style.paddingRight)
      );
    });
    const buttonBox = await button.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(contentRight).toBeLessThanOrEqual(buttonBox!.x);
  }
}
