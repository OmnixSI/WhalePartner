/**
 * 空态的三个建议（规范 §7.1.6）：聊聊今天（预填「今天……」）、发个视频给她、看看她的日记。
 * 三个都是同一种次按钮，不是按钮墙；手机上横向滑动。
 */
import { Link } from "react-router-dom";
import { Button } from "../ui/Button";

type Props = {
  onToday: () => void;
  onVideo: () => void;
};

export function SuggestionChips({ onToday, onVideo }: Props) {
  return (
    <div className="suggests" aria-label="可以这样开始">
      <Button onClick={onToday}>聊聊今天</Button>
      <Button onClick={onVideo}>发个视频给她</Button>
      <Link className="ui-btn ui-btn--secondary ui-press ui-focus" to="/diary">
        看看她的日记
      </Link>
    </div>
  );
}
