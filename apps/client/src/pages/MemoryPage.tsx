import { MemoryIcon } from "../components/Icons";

/** B3 在这里列出她记得的事，并允许删除。 */
export function MemoryPage() {
  return (
    <div className="page">
      <div className="page__inner">
        <header>
          <p className="page__eyebrow">Memory</p>
          <h1 className="page__title">她记得的事</h1>
          <p className="page__lead">你说过的话、重要的日子和她看过的内容。你可以随时查看，也可以让她忘掉。</p>
        </header>
        <div className="card empty">
          <MemoryIcon style={{ width: 64, height: 64, color: "var(--accent)" }} />
          <h3>记忆还是空的</h3>
          <p>多聊几句，她就会开始记住你。</p>
        </div>
      </div>
    </div>
  );
}
