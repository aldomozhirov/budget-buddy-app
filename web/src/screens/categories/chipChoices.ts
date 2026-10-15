/**
 * The first `max` items for a chip row, with the picked one in front when it
 * is not among them (UI-NAV-7: a pick from a sheet goes to the front).
 */
export function chipChoices<T extends { id: number }>(
  items: readonly T[],
  pickedId: number | null,
  max: number,
): T[] {
  const chips = items.slice(0, max);
  const picked = items.find((item) => item.id === pickedId);
  if (picked && !chips.includes(picked)) {
    chips.unshift(picked);
    chips.splice(max);
  }
  return chips;
}
