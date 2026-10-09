import type { CliRejection } from "./cli-params";

type DiagnosticCode<THints> = Extract<keyof THints, string>;

/**
 * Build the diagnostics of one CLI namespace from its registered recovery
 * actions. The namespace keeps its own code vocabulary and details union.
 */
export function createCliDiagnostics<
  const THints extends Readonly<Record<string, string>>,
  TDetails,
>(hints: THints, invalidParameterCode: DiagnosticCode<THints>) {
  type Code = DiagnosticCode<THints>;

  function buildDiagnostic<TDiagnosticDetails>(
    code: Code,
    message: string,
    details?: TDiagnosticDetails,
  ) {
    const hint: string = hints[code]!;
    return { code, message, hint, details };
  }

  function diagnostic(code: Code, message: string, details?: TDetails) {
    return buildDiagnostic(code, message, details);
  }

  function rejectionDiagnostic(rejection: CliRejection) {
    const rejected = buildDiagnostic(invalidParameterCode, rejection.message, {
      parameter: rejection.parameter,
    });
    return rejection.hint === undefined
      ? rejected
      : { ...rejected, hint: rejection.hint };
  }

  return { diagnostic, rejectionDiagnostic };
}
