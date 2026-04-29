/**
 * Probe interface used by every "Test connection" button in the
 * wizard. Implementations are framework-agnostic and stateless; each
 * call MUST clean up any resources it opened, even on failure.
 */
export type TestResult<TDetail = unknown,> =
    | { ok: true; detail?: TDetail; }
    | { ok: false; error: string; code?: string; };

export interface ConnectionTester<TInput, TDetail = unknown,> {
    test(input: TInput,): Promise<TestResult<TDetail>>;
}
