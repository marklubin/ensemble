import { Link } from "react-router-dom";
import "./pre-topbar.css";

export interface PreTopBarProps {
  crumb: string;
  showManagePersonas?: boolean;
}

/** Top navigation bar shared across pre-session screens.
 *  Mirrors the mockup's `.topbar` styling (paper aesthetic). */
export function PreTopBar({ crumb, showManagePersonas = true }: PreTopBarProps) {
  return (
    <div className="pre-topbar">
      <div className="pre-topbar-inner">
        <Link to="/" className="pre-topbar-brand">
          ensemble
        </Link>
        <span className="pre-topbar-sep" />
        <span className="pre-topbar-crumbs">
          <b>{crumb}</b>
        </span>
        <div className="pre-topbar-actions">
          {showManagePersonas && (
            <Link to="/personas" className="pre-topbar-btn">
              Manage personas
            </Link>
          )}
          <a
            href="https://marklubin.github.io/ensemble/article.html"
            target="_blank"
            rel="noopener noreferrer"
            className="pre-topbar-btn"
          >
            The design ↗
          </a>
          <a
            href="https://github.com/marklubin/ensemble"
            target="_blank"
            rel="noopener noreferrer"
            className="pre-topbar-btn"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </div>
  );
}
