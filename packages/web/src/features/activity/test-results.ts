/*
 * ADR-0038 §1: the status of a tester's test results comment, from its status line ("Tests
 * passed." or "Tests failed: …", written by the engine). A comment split into parts heads each
 * part with "(part i of n)"; only the first part has the status line. Null when no line says it.
 */
export type TestResultsStatus = 'passed' | 'failed';

export function testResultsStatus(body: string): TestResultsStatus | null {
  for (const line of body.split('\n', 3)) {
    if (line.startsWith('Tests passed.')) return 'passed';
    if (line.startsWith('Tests failed')) return 'failed';
  }
  return null;
}
