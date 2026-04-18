type Props = {
  popoverId: string;
  triggerLabel: string;
  triggerAriaLabel?: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
};

export function ConfirmButton({
  popoverId,
  triggerLabel,
  triggerAriaLabel,
  message,
  confirmLabel,
  onConfirm,
}: Props) {
  return (
    <>
      <button type="button" aria-label={triggerAriaLabel} popoverTarget={popoverId}>
        {triggerLabel}
      </button>
      <div id={popoverId} popover="auto" className="confirm-popover">
        <p>{message}</p>
        <div className="confirm-popover-actions">
          <button type="button" popoverTarget={popoverId} popoverTargetAction="hide">
            キャンセル
          </button>
          <button
            type="button"
            popoverTarget={popoverId}
            popoverTargetAction="hide"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
