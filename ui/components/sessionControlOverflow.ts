export const controlsOverflow = (availableWidth: number, requiredWidth: number): boolean =>
  availableWidth > 0 && requiredWidth - availableWidth > 1
