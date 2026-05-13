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
          <button className="pre-topbar-btn" type="button">History</button>
          <button className="pre-topbar-btn" type="button">Settings</button>
        </div>
      </div>
    </div>
  );
}
