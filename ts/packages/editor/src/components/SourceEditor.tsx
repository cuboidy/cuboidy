import { useMemo, type ChangeEvent } from 'react';

interface Props {
  text: string;
  parseError?: string;
  onChange: (next: string) => void;
}

// Editable source view for cvox text. The textarea is the primary
// authoring surface — App treats text as source-of-truth and derives
// AST via debounced re-parse. Layout: row flex with a sticky line-
// number gutter on the left + a transparent-background textarea on
// the right. Both share line-height so gutter rows align with text
// rows naturally; no JavaScript scroll-sync needed because the outer
// container is what scrolls (textarea height grows with content).
//
// Deliberate non-features (for MVP):
//   - No syntax highlighting. cvox grammar is small; a future
//     CodeMirror 6 mode can be added if demand emerges.
//   - No bracket matching / autocomplete / multi-cursor. textarea
//     gives us baseline editor behavior (undo/redo, copy/paste,
//     find via browser Ctrl+F) for free.
//   - Tab key still moves focus rather than inserting a tab. Future
//     keydown handler can intercept Tab when worth it.

export function SourceEditor({ text, parseError, onChange }: Props) {
  // Line count drives both the gutter rows and the textarea row
  // count. Recomputed on every render — cvox files are <10k lines in
  // any realistic case, so the cost is negligible.
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const gutterChars = String(lines.length).length;

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className="source-editor">
      {parseError !== undefined && (
        <div className="parse-error-banner" role="alert">
          <strong>Parse error:</strong> {parseError}
        </div>
      )}
      <div className="source-editor-body">
        <div className="source-editor-content">
          <div className="line-gutter" aria-hidden="true">
            {lines.map((_, i) => (
              <div
                key={i}
                className="line-no"
                style={{ width: `${gutterChars}ch` }}
              >
                {i + 1}
              </div>
            ))}
          </div>
          <textarea
            className="source-textarea"
            value={text}
            rows={Math.max(1, lines.length)}
            spellCheck={false}
            wrap="off"
            onChange={handleChange}
          />
        </div>
      </div>
    </div>
  );
}
