export interface AppFooterProps {
  onShowAbout: () => void;
  onShowLicenseNotice: () => void;
}

export const AppFooter = ({
  onShowAbout,
  onShowLicenseNotice,
}: AppFooterProps) => {
  return (
    <div className="flex items-center justify-between border-t border-border bg-base-200 px-3 py-1.5">
      <span className="text-2xs text-muted">&copy; ZMK Contributors</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="text-2xs text-muted hover:text-base-content transition-colors"
          onClick={onShowAbout}
        >
          このアプリについて
        </button>
        <button
          type="button"
          className="text-2xs text-muted hover:text-base-content transition-colors"
          onClick={onShowLicenseNotice}
        >
          ライセンス
        </button>
      </div>
    </div>
  );
};
