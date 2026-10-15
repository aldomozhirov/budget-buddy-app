import { describe, expect, it } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { historySummary } from '../src/screens/envelopes/envelopeFormat';
import BarChart from '../src/components/charts/BarChart.vue';
import BbAmount from '../src/components/BbAmount.vue';
import BbChip from '../src/components/BbChip.vue';
import BbChipGroup from '../src/components/BbChipGroup.vue';
import BbListCard from '../src/components/BbListCard.vue';
import BbProgress from '../src/components/BbProgress.vue';
import BbSegmented from '../src/components/BbSegmented.vue';
import BbSwitch from '../src/components/BbSwitch.vue';

/** Renders a component to an HTML string, as the server would. */
function render(component: Component, props: Record<string, unknown> = {}) {
  return renderToString(createSSRApp({ render: () => h(component, props) }));
}

const options = [
  { label: 'Card', value: 'card' },
  { label: 'Cash', value: 'cash' },
];

describe('BbAmount', () => {
  it('hides the dots from screen readers and reads the hidden label', async () => {
    const html = await render(BbAmount, {
      value: '€84,215.00',
      visible: false,
    });
    expect(html).not.toContain('aria-label=');
    expect(html).toContain('<span aria-hidden="true">€ • • • • •</span>');
    expect(html).toContain(
      '<span class="visually-hidden">Amount hidden</span>',
    );
    expect(html).not.toContain('84,215');
  });

  it('shows the amount as plain text when visible', async () => {
    const html = await render(BbAmount, { value: '€84,215.00' });
    expect(html).toContain('€84,215.00');
    expect(html).not.toContain('aria-hidden');
  });
});

describe('BbListCard', () => {
  it('names a labelled div through the group role', async () => {
    const html = await render(BbListCard, { label: 'Family wealth' });
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Family wealth"');
  });

  it('adds no role to a section or an unlabelled card', async () => {
    expect(
      await render(BbListCard, { label: 'Wealth', as: 'section' }),
    ).not.toContain('role=');
    expect(await render(BbListCard)).not.toContain('role=');
  });
});

describe('BbSegmented', () => {
  it('is a radio group with the selected option as the tab stop', async () => {
    const html = await render(BbSegmented, {
      modelValue: 'cash',
      options,
      label: 'Kind',
    });
    expect(html).toContain('role="radiogroup"');
    expect(html).not.toContain('role="tab');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true" tabindex="0"/);
  });

  it('keeps the first option reachable when nothing is selected', async () => {
    const html = await render(BbSegmented, {
      modelValue: 'none',
      options,
      label: 'Kind',
    });
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.indexOf('tabindex="0"')).toBeLessThan(
      html.indexOf('tabindex="-1"'),
    );
  });
});

describe('BbChip', () => {
  it('is a radio inside BbChipGroup', async () => {
    const html = await render(BbChipGroup, {
      modelValue: 'card',
      options,
      label: 'Paid from',
    });
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).not.toContain('aria-pressed');
  });

  it('is a toggle button on its own', async () => {
    for (const variant of ['choice', 'small', 'pill']) {
      const html = await render(BbChip, { variant, selected: true });
      expect(html, variant).not.toContain('role="radio"');
      expect(html, variant).toContain('aria-pressed="true"');
    }
  });

  it('keeps plain buttons free of state', async () => {
    const html = await render(BbChip, { variant: 'ghost' });
    expect(html).not.toMatch(/aria-(pressed|checked)|role=/);
  });
});

describe('BbProgress', () => {
  it('reads an overspent value with its real share', async () => {
    const html = await render(BbProgress, {
      value: 120,
      label: 'Budget',
      over: true,
    });
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-valuetext="120%, over the limit"');
  });

  it('uses the caller’s wording and adds nothing when not over', async () => {
    expect(
      await render(BbProgress, {
        value: 120,
        label: 'Budget',
        over: true,
        valueText: '€120 of €100',
      }),
    ).toContain('aria-valuetext="€120 of €100"');
    expect(
      await render(BbProgress, { value: 40, label: 'Budget' }),
    ).not.toContain('aria-valuetext');
  });
});

describe('BbSwitch', () => {
  it('keeps aria-checked on the switch only', async () => {
    const html = await render(BbSwitch, {
      modelValue: true,
      label: 'Reminders',
    });
    expect(html.match(/aria-checked/g)).toHaveLength(1);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
  });
});

describe('BarChart', () => {
  const bars = [
    { label: 'Aug', value: 49700n, title: 'August: €497.00' },
    { label: 'Sep', value: 54100n, title: 'September: €541.00' },
    { label: 'Oct', value: 31240n, title: 'October: €312.40', current: true },
  ];

  it('draws a bar per month, marks the ones over the limit and the open one', async () => {
    const html = await render(BarChart, {
      bars,
      limit: 50000n,
      limitLabel: '€500.00 limit',
      summary: 'Spent per month',
    });
    expect(html.match(/<rect/g)).toHaveLength(3);
    expect(html.match(/bar-chart-over/g)).toHaveLength(1);
    expect(html.match(/bar-chart-current/g)).toHaveLength(1);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Spent per month"');
    expect(html).toContain('€500.00 limit');
    expect(html).toMatch(/<title[^>]*>September: €541.00<\/title>/);
  });

  it('draws no bar for a month with nothing spent', async () => {
    const html = await render(BarChart, {
      bars: [{ label: 'Jan', value: 0n, title: 'January: €0.00' }],
      limit: 50000n,
      limitLabel: '€500.00 limit',
      summary: 'Spent per month',
    });
    expect(html).toContain('height="6"');
  });

  it('has a summary that calls the same months over as the bars', async () => {
    // A €500.00 plan with a +€50.00 adjustment: €541.00 spent leaves €9.00,
    // yet the bar is over the limit, so the summary must say so too.
    const month = (name: string, spent: string, closed: boolean) => ({
      month: name,
      spent,
      closed,
      closing: closed ? '900' : '0',
    });
    const months = [
      month('2026-08', '49700', true),
      month('2026-09', '54100', true),
      month('2026-10', '60000', false),
    ];
    const money = (value: string | bigint) => `€${value}`;
    const summary = historySummary(months as never, 50000n, money);
    expect(summary).toContain('September €54100, over the limit');
    expect(summary).not.toContain('August €49700, over');
    expect(summary).toContain('October €60000, this month');
    expect(summary.match(/over the limit/g)).toHaveLength(1);

    const html = await render(BarChart, {
      bars: months.map((item) => ({
        label: item.month,
        value: BigInt(item.spent),
        title: item.month,
        current: !item.closed,
      })),
      limit: 50000n,
      limitLabel: 'limit',
      summary,
    });
    expect(html.match(/bar-chart-over/g)).toHaveLength(1);
  });
});
