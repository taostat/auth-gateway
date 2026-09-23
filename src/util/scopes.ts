export function sameScopeSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = left.toSorted();
  const sortedRight = right.toSorted();
  return sortedLeft.every((scope, i) => scope === sortedRight[i]);
}
