export default function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">FFmpeg Visual Tool</p>
          <h1>静止画面剪切器</h1>
        </div>
        <button type="button" disabled>
          打开视频
        </button>
      </header>

      <section className="workspace" aria-label="视频审核工作区">
        <div className="player-placeholder">
          <strong>Iteration A1</strong>
          <span>桌面应用基础骨架已就绪</span>
        </div>

        <aside className="side-panel">
          <h2>静止区间</h2>
          <p>打开视频后，这里会显示 FFmpeg 检测出的静止画面区间。</p>
        </aside>
      </section>
    </main>
  );
}
