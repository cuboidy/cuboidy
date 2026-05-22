import type { FileEntry } from '../lib/types.js';

interface Props {
  file: FileEntry;
}

// Read-only raw text view of a loaded file. Future stages will replace
// this with type-specific editors:
//   - voxels.cvox → palette editor + per-part voxel painter (A2-rig-4)
//   - cuboidy.json → rig editor (A2-rig-5)
//   - anims/*.json → animation timeline (A2-rig-6)
// For now, the raw text gives users an immediate way to inspect what's
// actually in their files alongside the 3D preview — useful for
// understanding format syntax and for catching parser oddities.
//
// Lines are pre-numbered (gutter on the left) since voxel files often
// need positional reference ("layer y=2 row 3"). A `<pre>` preserves
// whitespace; outer `<div>` provides the scrollable container.

export function FilePreview({ file }: Props) {
  const lines = file.text.split(/\r?\n/);
  // Drop the trailing empty line that comes from a file ending with \n
  // — otherwise every file shows a spurious blank last line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const gutterWidth = String(lines.length).length;

  return (
    <div className="file-preview">
      <div className="file-preview-header">
        <span className="file-preview-name">{file.name}</span>
        <span className="file-preview-stats">
          {lines.length} line{lines.length === 1 ? '' : 's'} · {file.text.length} chars
        </span>
      </div>
      <pre className="file-preview-body">
        {lines.map((line, i) => (
          <div className="line" key={i}>
            <span className="line-no" style={{ width: `${gutterWidth}ch` }}>
              {i + 1}
            </span>
            <span className="line-text">{line === '' ? ' ' : line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
