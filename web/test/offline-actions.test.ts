import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';

/** Loads the components fresh, with the browser reporting `onLine`. */
async function load(onLine: boolean) {
  vi.resetModules();
  vi.stubGlobal('navigator', { onLine });
  const render = (component: Component, props: Record<string, unknown>) =>
    renderToString(createSSRApp({ render: () => h(component, props) }));
  return {
    render,
    BbButton: (await import('../src/components/BbButton.vue')).default,
    BbSwitch: (await import('../src/components/BbSwitch.vue')).default,
    BbAmountInput: (await import('../src/components/BbAmountInput.vue'))
      .default,
  };
}

const usd = { code: 'USD', decimals: 2 };
const disabled = /<button[^>]*\bdisabled\b/u;

afterEach(() => vi.unstubAllGlobals());

describe('actions that need the server (IOS-6)', () => {
  it('a button marked needsServer is disabled offline and enabled online', async () => {
    const offline = await load(false);
    expect(
      await offline.render(offline.BbButton, { needsServer: true }),
    ).toMatch(disabled);
    const online = await load(true);
    expect(
      await online.render(online.BbButton, { needsServer: true }),
    ).not.toMatch(disabled);
  });

  it('a button not marked needsServer keeps working offline', async () => {
    const offline = await load(false);
    expect(await offline.render(offline.BbButton, {})).not.toMatch(disabled);
  });

  it('a switch marked needsServer is disabled offline', async () => {
    const offline = await load(false);
    const props = { modelValue: false, label: 'Hide amounts' };
    expect(
      await offline.render(offline.BbSwitch, { ...props, needsServer: true }),
    ).toMatch(disabled);
    expect(await offline.render(offline.BbSwitch, props)).not.toMatch(disabled);
  });

  it('the amount editor cannot save offline when it needs the server', async () => {
    const offline = await load(false);
    const html = await offline.render(offline.BbAmountInput, {
      currency: usd,
      initialAmount: 1250n,
      needsServer: true,
    });
    // The save button is the last button of the editor.
    const buttons = html.match(/<button[^>]*>/gu) ?? [];
    expect(buttons.at(-1)).toMatch(/\bdisabled\b/u);
    const editable = await offline.render(offline.BbAmountInput, {
      currency: usd,
      initialAmount: 1250n,
    });
    expect((editable.match(/<button[^>]*>/gu) ?? []).at(-1)).not.toMatch(
      /\bdisabled\b/u,
    );
  });
});
