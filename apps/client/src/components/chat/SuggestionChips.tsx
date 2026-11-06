/**
 * 空态的三个建议芯片（规范 §7.1.6）：聊聊今天（预填「今天……」）、发个视频给她、看看她的日记。
 * 芯片是 secondary 样子的小纸片（高 44），不是按钮墙。
 */
import { Link } from "react-router-dom";

type Props = {
  onToday: () => void;
  onVideo: () => void;
};

export function SuggestionChips({ onToday, onVideo }: Props) {
  return (
    <div className="chips" aria-label="可以这样开始">
      <button type="button" className="chip" onClick={onToday}>
        聊聊今天
      </button>
      <button type="button" className="chip" onClick={onVideo}>
        发个视频给她
      </button>
      <Link className="chip" to="/diary">
        看看她的日记
      </Link>
    </div>
  );
}
