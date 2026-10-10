const openSheets: object[] = [];

interface ScrollTargetSnapshot {
  element: HTMLElement;
  overflowY: string;
  overscrollBehaviorY: string;
  scrollTop: number;
}

interface PageScrollSnapshot {
  scrollX: number;
  scrollY: number;
  htmlOverflow: string;
  htmlOverscrollBehaviorY: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
  bodyOverflow: string;
  targets: ScrollTargetSnapshot[];
}

let pageScrollSnapshot: PageScrollSnapshot | undefined;

function lockPageScroll(): void {
  const html = document.documentElement;
  const body = document.body;
  const targets = Array.from(
    document.querySelectorAll<HTMLElement>('*'),
  ).filter((element) => {
    if (element.closest('.sheet')) return false;
    const overflowY = getComputedStyle(element).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll';
  });

  pageScrollSnapshot = {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    htmlOverflow: html.style.overflow,
    htmlOverscrollBehaviorY: html.style.overscrollBehaviorY,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    targets: targets.map((element) => ({
      element,
      overflowY: element.style.overflowY,
      overscrollBehaviorY: element.style.overscrollBehaviorY,
      scrollTop: element.scrollTop,
    })),
  };

  html.style.overflow = 'hidden';
  html.style.overscrollBehaviorY = 'none';
  body.style.position = 'fixed';
  body.style.top = `-${pageScrollSnapshot.scrollY}px`;
  body.style.left = `-${pageScrollSnapshot.scrollX}px`;
  body.style.right = 'auto';
  body.style.width = '100%';
  body.style.overflow = 'hidden';

  for (const { element } of pageScrollSnapshot.targets) {
    element.style.overflowY = 'hidden';
    element.style.overscrollBehaviorY = 'none';
  }
}

function unlockPageScroll(): void {
  const snapshot = pageScrollSnapshot;
  if (!snapshot) return;

  const html = document.documentElement;
  const body = document.body;
  html.style.overflow = snapshot.htmlOverflow;
  html.style.overscrollBehaviorY = snapshot.htmlOverscrollBehaviorY;
  body.style.position = snapshot.bodyPosition;
  body.style.top = snapshot.bodyTop;
  body.style.left = snapshot.bodyLeft;
  body.style.right = snapshot.bodyRight;
  body.style.width = snapshot.bodyWidth;
  body.style.overflow = snapshot.bodyOverflow;
  window.scrollTo(snapshot.scrollX, snapshot.scrollY);

  for (const target of snapshot.targets) {
    target.element.style.overflowY = target.overflowY;
    target.element.style.overscrollBehaviorY = target.overscrollBehaviorY;
    target.element.scrollTop = target.scrollTop;
  }
  pageScrollSnapshot = undefined;
}

/** Registers a sheet in the shared order in which sheets are rendered. */
export function registerSheet(token: object): void {
  if (openSheets.length === 0) lockPageScroll();
  openSheets.push(token);
}

/** Removes a sheet from the shared stack when its component unmounts. */
export function unregisterSheet(token: object): void {
  const index = openSheets.indexOf(token);
  if (index === -1) return;
  openSheets.splice(index, 1);
  if (openSheets.length === 0) unlockPageScroll();
}

/** Returns whether this sheet is the topmost open sheet. */
export function isTopSheet(token: object): boolean {
  return openSheets.at(-1) === token;
}
