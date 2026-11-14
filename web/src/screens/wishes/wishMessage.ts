import { ref } from 'vue';

/** A short message with an optional Undo call, shown by Wishes. */
export interface WishMessage {
  text: string;
  /** Takes the change back; null when it cannot be undone. */
  undo: (() => Promise<void>) | null;
  /** The month Wishes opens on, when it is not the current one. */
  month?: string;
}

/**
 * The message the wish form leaves for Wishes: the form navigates away as
 * soon as it has acted, so Wishes shows the message and its Undo (UI-WSH-3).
 */
export const pendingWishMessage = ref<WishMessage | null>(null);

/** Takes the pending message, so only one screen shows it. */
export function takeWishMessage(): WishMessage | null {
  const message = pendingWishMessage.value;
  pendingWishMessage.value = null;
  return message;
}
