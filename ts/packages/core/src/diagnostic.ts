export type Severity = 'error' | 'warning' | 'hint';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
}
