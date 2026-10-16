import { ICONS } from "../app/icons";
import { Icon } from "../components/Icon";

/** The spinner line under an opened page: "I'll notice when it changes." */
export function WatchStrip({ text }: { text: string }) {
  return (
    <p className="guided-status guided-watch" role="status">
      <Icon icon={ICONS.rescan} size={20} className="spin" />
      <span>{text}</span>
    </p>
  );
}
