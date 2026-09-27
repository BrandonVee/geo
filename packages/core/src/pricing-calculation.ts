export function calculateMarkedUpPoints(basePoints: number, markupBps: number) {
  return Math.ceil((basePoints * (10_000 + markupBps)) / 10_000);
}
