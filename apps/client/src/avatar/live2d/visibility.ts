/**
 * Live2D 只在看得见的时候画：窗口隐藏或舞台离开视口时停掉 ticker（没有 rAF、没有定时器），
 * 回来时再启动。看得见时一律按显示器刷新率画，不降帧。
 */
export interface PausableTicker {
  readonly started: boolean;
  start(): void;
  stop(): void;
}

export function syncTickerToVisibility(ticker: PausableTicker, hidden: boolean) {
  if (hidden) {
    if (ticker.started) ticker.stop();
  } else if (!ticker.started) {
    ticker.start();
  }
}
