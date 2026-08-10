// Port of ts/packages/core/src/diagnostic.ts — the narrow half of it.
//
// `Diagnostic` and `LintRuleId` are NOT ported. `LintRuleId` is a vocabulary
// of eleven authoring-time rules (W01..W08, H01..H03) and this library has no
// lint, so it could never populate them; carrying the enum would be an API
// promise it cannot keep. `docs/csharp-implementation.md` draws the line as
// "resolution is in scope, reporting is not", and TypeScript draws the same
// line in its types — `ResolutionDiagnostic` is `Diagnostic` without
// `ruleId`, and `project.ts` never set `ruleId` at any of its sites.
//
// So here the narrow one is the only one, under the name TypeScript gives it.

namespace Cuboidy;

public enum Severity
{
    Error,
    Warning,
    Hint,
}

// What a RESOLVER can say: a file it could not read, a reference it could not
// bind, a name it could not disambiguate.
public sealed record ResolutionDiagnostic(
    // Structural category (SPEC §11.2).
    CuboidyErrorCode Code,
    Severity Severity,
    string Message);
