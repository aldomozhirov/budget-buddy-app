const openSheets: object[] = [];

/** Registers a sheet in the shared order in which sheets are rendered. */
export function registerSheet(token: object): void {
  openSheets.push(token);
}

/** Removes a sheet from the shared stack when its component unmounts. */
export function unregisterSheet(token: object): void {
  const index = openSheets.indexOf(token);
  if (index !== -1) openSheets.splice(index, 1);
}

/** Returns whether this sheet is the topmost open sheet. */
export function isTopSheet(token: object): boolean {
  return openSheets.at(-1) === token;
}
