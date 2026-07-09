export function cognosDialogOptions(ariaLabel?: string) {
  return {
    backdropClass: 'cog-dialog-backdrop',
    panelClass: 'cog-dialog-panel',
    ...(ariaLabel ? { ariaLabel } : {}),
  };
}
