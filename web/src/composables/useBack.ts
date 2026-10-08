import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  fallbackLocation,
  navigationStack,
  navigateBack,
  router,
} from '../router';

/** Back target and action for a screen in the in-memory navigation stack. */
export function useBack() {
  const route = useRoute();
  const destination = computed(
    () => navigationStack.value.at(-1) ?? fallbackLocation(route.path),
  );
  const label = computed(() => {
    const title = router.resolve(destination.value).meta.title;
    return `Back to ${String(title ?? 'home').toLowerCase()}`;
  });

  return {
    label,
    goBack: () => navigateBack(route.path),
  };
}
