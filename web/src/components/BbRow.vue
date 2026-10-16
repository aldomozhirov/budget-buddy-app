<script setup lang="ts">
/**
 * List row with a title, optional subtitle and trailing value, usually inside
 * BbListCard. Renders a link with `href`, a button with `interactive`, else a
 * `div`. Slots: `leading`, `title` (replaces `title`), `trailing` (replaces
 * `value`).
 */
withDefaults(
  defineProps<{
    /** Main text; ignored when the `title` slot is used. */
    title?: string;
    /** Secondary line under the title; omitted when empty. */
    subtitle?: string;
    /** Trailing text, e.g. an amount; ignored when `trailing` is used. */
    value?: string;
    /** Render the row as a link to this URL. */
    href?: string;
    /** Render the row as a button (when there is no `href`). */
    interactive?: boolean;
    /** Button type; applies only when the row renders as a button. */
    type?: 'button' | 'submit' | 'reset';
  }>(),
  {
    title: '',
    subtitle: '',
    value: '',
    href: '',
    interactive: false,
    type: 'button',
  },
);

defineOptions({ inheritAttrs: false });
</script>

<template>
  <component
    :is="href ? 'a' : interactive ? 'button' : 'div'"
    v-bind="$attrs"
    :href="href || undefined"
    :type="interactive && !href ? type : undefined"
    class="row"
  >
    <slot name="leading" />
    <span class="row-l">
      <slot name="title">{{ title }}</slot>
      <span
        v-if="subtitle"
        class="t-sub"
      >{{ subtitle }}</span>
    </span>
    <slot name="trailing">
      <span
        v-if="value"
        class="row-v"
      >{{ value }}</span>
    </slot>
  </component>
</template>
