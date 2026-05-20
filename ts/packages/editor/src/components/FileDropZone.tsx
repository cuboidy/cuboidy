import { useCallback, useState, type ChangeEvent, type DragEvent } from 'react';

interface Props {
  onFile: (file: File) => void;
}

// Single-file drop zone for `.cvox` input. Folder / multi-file drops
// (which would let us pair voxels.cvox with cuboidy.json) are deferred
// until manifest rendering is needed — A1 viewer only inspects voxels.

export function FileDropZone({ onFile }: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file !== undefined) onFile(file);
    },
    [onFile],
  );

  const handlePick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file !== undefined) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      className={`dropzone${isDragging ? ' dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <p>
        Drop a <code>voxels.cvox</code> file here
      </p>
      <p className="sep">or</p>
      <label className="pick">
        <input type="file" accept=".cvox,text/plain" onChange={handlePick} />
        <span>Choose a file</span>
      </label>
    </div>
  );
}
