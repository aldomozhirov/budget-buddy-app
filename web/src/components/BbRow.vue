<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    value?: string;
    href?: string;
    interactive?: boolean;
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
