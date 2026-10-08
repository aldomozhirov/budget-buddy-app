import type { InjectionKey } from 'vue';

/**
 * Provided by BbChipGroup so its chips act as radio buttons. A chip without
 * it is a stand-alone toggle button instead.
 */
export const inChipGroupKey: InjectionKey<true> = Symbol('inChipGroup');
