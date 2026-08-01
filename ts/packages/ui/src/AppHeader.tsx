import type { ReactNode } from 'react';
import { Logo } from './Logo.js';

interface Props {
  // The product name, shown after the mark: "Editor", "Workspace". The
  // "CUBOIDY" half is the shared part and is drawn here, so the two apps
  // cannot drift on capitalisation, tracking or spacing — which is most
  // of what makes two windows look like one product.
  product: string;
  // App-specific controls beside the wordmark (settings, and anything
  // else that is about the view rather than the document).
  left?: ReactNode;
  // The document/session controls: history, save, open.
  right?: ReactNode;
}

export function AppHeader({ product, left, right }: Props) {
  return (
    <header className="app-header">
      <div className="app-header-side">
        <div className="app-brand">
          <Logo />
          <h1>
            Cuboidy <span className="app-brand-product">{product}</span>
          </h1>
        </div>
        {left !== undefined && (
          <>
            <HeaderDivider />
            {left}
          </>
        )}
      </div>
      <div className="app-header-side">{right}</div>
    </header>
  );
}

// A cluster of same-meaning controls (history, document I/O), tightly
// spaced. Dividers set one cluster off from the next.
export function HeaderGroup({ children }: { children: ReactNode }) {
  return <div className="app-header-group">{children}</div>;
}

export function HeaderDivider() {
  return <span className="app-header-divider" aria-hidden="true" />;
}
