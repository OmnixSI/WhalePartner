/** 页面级排他锁：导出、清空全部时挡住聊天写入，避免写到一半被改。 */
let holders = 0;

/** 拿锁；返回释放函数（重复调用不会把计数减成负数）。 */
export function beginExclusiveLock(): () => void {
  holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
  };
}

export function isExclusiveActive(): boolean {
  return holders > 0;
}

export const BUSY_MESSAGE = "正在整理数据，请稍后再来。";
