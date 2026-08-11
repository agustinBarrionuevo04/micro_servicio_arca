/**
 * Shared placeholder for routes owned by other in-flight branches. Keeps each page file to a
 * one-liner while still rendering something visibly identifiable during manual QA of the shell.
 */

export function PageStub({ branch }: { branch: string }) {
  return <div>TODO: {branch}</div>;
}
