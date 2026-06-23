import { useModalRef } from "./useModalRef";

import NOTICE from "../../NOTICE?raw";
import { GenericModal } from "../GenericModal";

export interface LicenseNoticeModalProps {
  open: boolean;
  onClose: () => void;
}

export const LicenseNoticeModal = ({
  open,
  onClose,
}: LicenseNoticeModalProps) => {
  const ref = useModalRef(open, true);

  return (
    <GenericModal
      ref={ref}
      className="min-w-min w-[60vw]"
      onClose={onClose}
    >
      <div>
        <div className="flex justify-between items-start">
          <p className="mr-2">
            ZMK Studio is released under the open source Apache 2.0 license. A
            copy of the NOTICE file from the ZMK Studio repository is included
            here:
          </p>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-base-300 hover:text-base-content transition-colors"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <pre className="m-4 font-mono text-xs">{NOTICE}</pre>
      </div>
    </GenericModal>
  );
};
