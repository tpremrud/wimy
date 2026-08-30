import type { ReadonlyActivityReceipt } from "../room/store";
import type { ActivityReceipt } from "../room/transaction";

type ReceiptPanelProps = {
  receipts: readonly ReadonlyActivityReceipt[];
};

const ORIGIN_LABELS: Record<ActivityReceipt["origin"], string> = {
  human: "Human",
  webmcp: "Agent",
  import: "Import",
  template: "Template",
  undo: "Undo",
};

export function ReceiptPanel({ receipts }: ReceiptPanelProps) {
  return (
    <section aria-labelledby="activity-receipts-heading">
      <h2 id="activity-receipts-heading">Activity receipts</h2>
      <ol>
        {receipts.map((receipt, index) => (
          <li key={`${receipt.revision}-${receipt.origin}-${index}`}>
            <strong>{ORIGIN_LABELS[receipt.origin]}</strong>
            <span>
              {receipt.status === "accepted" ? "Accepted" : "Rejected"}
            </span>
            <p>{receipt.summary}</p>
            <small>Revision {receipt.revision}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
