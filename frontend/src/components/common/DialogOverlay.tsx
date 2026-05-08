import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

interface DialogOverlayProps {
  onClose: () => void;
  children: ReactNode;
  overlayClassName?: string;
  dialogClassName?: string;
  ariaLabelledBy?: string;
  overlayStyle?: CSSProperties;
  dialogStyle?: CSSProperties;
  /** overlay クリックでの閉じるを抑止 (実行中など) */
  disableOverlayClose?: boolean;
}

// overlay 背景クリックでの閉じるは意図的 UX。ESC は useDialogKeyboard が window レベルで
// 共通処理するため、a11y/useKeyWithClickEvents は冗長。a11y/noStaticElementInteractions は
// role="presentation"/"dialog" 付与済だが biome は static 扱いするため抑止。
export function DialogOverlay({
  onClose,
  children,
  overlayClassName,
  dialogClassName,
  ariaLabelledBy,
  overlayStyle,
  dialogStyle,
  disableOverlayClose = false,
}: DialogOverlayProps) {
  const handleOverlayClick = () => {
    if (!disableOverlayClose) onClose();
  };
  const handleOverlayKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !disableOverlayClose) {
      e.stopPropagation();
      onClose();
    }
  };
  const stopPropagation = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: overlay backdrop は意図的 click-to-close。ESC は handleOverlayKeyDown と useDialogKeyboard 双方で対応
    <div
      className={overlayClassName}
      style={overlayStyle}
      onClick={handleOverlayClick}
      onKeyDown={handleOverlayKeyDown}
      role="presentation"
    >
      <div
        className={dialogClassName}
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={stopPropagation}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </div>
    </div>
  );
}
