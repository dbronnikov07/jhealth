import type { Status } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/format";

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`pill ${status}`}>
      <i aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
