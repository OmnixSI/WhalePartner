import { DiaryIcon } from "../components/Icons";

/** D2（Spdor）在这里接入日记列表和“添加链接”入口。 */
export function DiaryPage() {
  return (
    <div className="page">
      <div className="page__inner">
        <header>
          <p className="page__eyebrow">Diary</p>
          <h1 className="page__title">她的日记</h1>
          <p className="page__lead">鲸汐看过的视频、想到的事，会在这里变成一篇篇日记。</p>
        </header>
        <div className="card empty">
          <DiaryIcon style={{ width: 64, height: 64, color: "var(--accent)" }} />
          <h3>还没有日记</h3>
          <p>等视频摘要和定时日记接入后，这里会按日期显示她写下的内容。</p>
        </div>
      </div>
    </div>
  );
}
