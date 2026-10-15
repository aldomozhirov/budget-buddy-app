<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  classifyExpressionError,
  evaluateExpression,
  formatMoney,
  lastCompleteValue,
  type Currency,
} from '@budget-buddy/shared';
import BbKeypad from './BbKeypad.vue';
import { isOnline } from '../composables/useOnline';

/**
 * Amount editor that uses text and buttons so the system keyboard never opens.
 * It has no slots; values emitted to callers are exact minor-unit integers.
 */
const props = withDefaults(
  defineProps<{
    /** Currency that controls result precision and formatting. */
    currency: Currency;
    /** Allows a unary minus at the start of the expression or after `(`. */
    allowNegative?: boolean;
    /** Optional amount to show when the editor opens or this value changes. */
    initialAmount?: bigint | null;
    /** Previous balance; when present, shows the "Start from last" action. */
    lastAmount?: bigint | null;
    /** Accessible name for the focused amount display. */
    label?: string;
    /** Text shown on the enabled save button. */
    saveLabel?: string;
    /** Prevents further saves while the caller's request is pending. */
    saving?: boolean;
    /** Saving calls the server, so it is disabled while offline (IOS-6). */
    needsServer?: boolean;
    /**
     * Keypad only: no display, "Start from last" or save button. The caller
     * shows the value from `change` and saves it itself.
     */
    bare?: boolean;
    /** A line under the amount, e.g. what is left in an envelope. */
    hint?: string;
    /** Shows `hint` in the warning colour. */
    hintWarn?: boolean;
  }>(),
  {
    allowNegative: false,
    initialAmount: null,
    lastAmount: null,
    label: 'Amount',
    saveLabel: 'Save',
    saving: false,
    needsServer: false,
    bare: false,
    hint: '',
    hintWarn: false,
  },
);

/** What `change` reports after each edit of a bare keypad. */
export interface AmountChange {
  /** The calculated amount; null while empty or incomplete. */
  amount: bigint | null;
  /** Nothing is typed. */
  empty: boolean;
  /** The expression is empty or complete, so its value can be used. */
  valid: boolean;
  /** The result formatted, or the typed expression once it has an operator. */
  text: string;
  /** Why the expression cannot be calculated; empty while it is fine. */
  error: string;
}

const offline = computed(() => props.needsServer && !isOnline.value);

/**
 * Emits the valid amount as it changes, or when the caller saves it. `change`
 * reports every edit with what to show: the typed expression (when it has an
 * operator) or the result, and whether the expression is empty or complete.
 */
const emit = defineEmits<{
  'update:amount': [amount: bigint | null];
  save: [amount: bigint];
  change: [state: AmountChange];
}>();

const expression = ref('');

const evaluation = computed(() =>
  expression.value.trim()
    ? evaluateExpression(expression.value, props.currency)
    : undefined,
);

const preview = computed(() => {
  const result = evaluation.value;
  if (!result) return undefined;
  return result.ok
    ? result.value
    : lastCompleteValue(expression.value, props.currency);
});

const resultText = computed(() =>
  formatMoney(preview.value ?? 0n, props.currency),
);

const hasOperator = computed(() => /[+−\-×÷*/%]/.test(expression.value));
const error = computed(() => {
  const result = evaluation.value;
  if (!result || result.ok) return '';
  switch (classifyExpressionError(expression.value, result.reason)) {
    case 'incomplete':
      return '';
    case 'brackets':
      return 'Can’t calculate that. Check the brackets.';
    case 'division-by-zero':
      return 'Can’t divide by zero.';
    case 'too-large':
      return 'Amount is too large';
    case 'other':
      return 'Can’t calculate that.';
  }
  return 'Can’t calculate that.';
});
const canSave = computed(() => evaluation.value?.ok === true);
const minusDisabled = computed(() => {
  const trimmed = expression.value.trimEnd();
  const base = /[+−×÷]$/.test(trimmed)
    ? trimmed.slice(0, -1)
    : expression.value;
  const unaryPosition = !base.trim() || base.trimEnd().endsWith('(');
  return unaryPosition && !props.allowNegative;
});
const hasLastAmount = computed(() => props.lastAmount !== null);

watch(
  () => props.initialAmount,
  (amount) => {
    expression.value =
      amount === null ? '' : toExpression(amount, props.currency);
  },
  { immediate: true },
);

/** Converts integer minor units to a plain, exact expression literal. */
function toExpression(amount: bigint, currency: Currency): string {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const sign = negative ? '−' : '';
  if (currency.decimals === 0) return `${sign}${magnitude}`;

  const factor = 10n ** BigInt(currency.decimals);
  const whole = magnitude / factor;
  const fraction = (magnitude % factor)
    .toString()
    .padStart(currency.decimals, '0');
  return `${sign}${whole}.${fraction}`;
}

/** Updates the expression and publishes its currently calculable amount. */
function setExpression(next: string): void {
  expression.value = next;
  const result = next.trim()
    ? evaluateExpression(next, props.currency)
    : undefined;
  emit('update:amount', result?.ok ? result.value : null);
  const shown = result?.ok
    ? result.value
    : next.trim()
      ? lastCompleteValue(next, props.currency)
      : undefined;
  emit('change', {
    amount: result?.ok ? result.value : null,
    empty: !next.trim(),
    valid: !next.trim() || result?.ok === true,
    text: /[+−\-×÷*/%]/.test(next)
      ? next
      : formatMoney(shown ?? 0n, props.currency),
    error: error.value,
  });
}

/** Applies a keypad or hardware-keyboard token to the expression. */
function press(key: string): void {
  if (key === 'C') {
    setExpression('');
    return;
  }
  if (key === '⌫') {
    setExpression(expression.value.slice(0, -1));
    return;
  }

  const trimmed = expression.value.trimEnd();
  const replacesOperator = /[+−×÷]$/.test(trimmed);
  const base = replacesOperator ? trimmed.slice(0, -1) : expression.value;
  const unaryPosition = !base.trim() || base.trimEnd().endsWith('(');
  if (key === '−' && unaryPosition && !props.allowNegative) return;
  if (['+', '×', '÷', '%'].includes(key) && unaryPosition) return;

  if (/[+−×÷]/.test(key) && replacesOperator) {
    setExpression(`${base}${key}`);
    return;
  }
  setExpression(`${expression.value}${key}`);
}

/** Places the previous balance into the expression without converting it. */
function startFromLast(): void {
  if (props.lastAmount !== null) {
    setExpression(toExpression(props.lastAmount, props.currency));
  }
}

/** Saves only a complete expression that the shared money parser accepts. */
function save(): void {
  if (props.saving || offline.value) return;
  const result = evaluation.value;
  if (result?.ok) emit('save', result.value);
}

/** Maps physical keyboard keys to the keypad's typographic tokens. */
function onKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey) return;

  const hardwareKeys: Record<string, string> = {
    ',': '.',
    '.': '.',
    '+': '+',
    '-': '−',
    '*': '×',
    '/': '÷',
    '%': '%',
    '(': '(',
    ')': ')',
  };
  const target = event.target;

  if (event.key === 'Enter') {
    if (
      target instanceof HTMLElement &&
      target.classList.contains('amount-entry-display')
    ) {
      event.preventDefault();
      save();
    }
    return;
  }

  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    press(event.key);
  } else if (event.key === 'Backspace') {
    event.preventDefault();
    press('⌫');
  } else if (event.key === 'Delete') {
    event.preventDefault();
    press('C');
  } else if (event.key.toLowerCase() === 'c') {
    event.preventDefault();
    press('C');
  } else if (Object.hasOwn(hardwareKeys, event.key)) {
    event.preventDefault();
    press(hardwareKeys[event.key] ?? '');
  }
}
</script>

<template>
  <div class="amount-entry" @keydown="onKeydown">
    <div
      v-if="!bare"
      class="amount-entry-display"
      role="group"
      :aria-label="label"
      tabindex="0"
    >
      <div v-if="hasOperator" class="amount-expr">
        {{ expression }}
      </div>
      <div
        class="amount"
        :class="{ muted: !expression }"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ resultText }}
      </div>
      <div v-if="hint" class="amount-entry-hint" :class="{ warn: hintWarn }">
        {{ hint }}
      </div>
      <div v-if="error" class="error" role="alert">
        {{ error }}
      </div>
    </div>

    <button
      v-if="hasLastAmount && !bare"
      class="text-btn amount-entry-start-last"
      type="button"
      @click="startFromLast"
    >
      Start from last
    </button>

    <BbKeypad :minus-disabled="minusDisabled" @press="press" />

    <button
      v-if="!bare"
      class="primary"
      type="button"
      :disabled="!canSave || saving || offline"
      @click="save"
    >
      {{ canSave ? saveLabel : 'Enter an amount' }}
    </button>
  </div>
</template>
