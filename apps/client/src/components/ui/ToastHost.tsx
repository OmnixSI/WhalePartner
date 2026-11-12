/**
 * App 根部唯一的吐司出口。第一次有吐司时才加载 Toaster（Radix Toast 不进首屏），之后一直挂着；
 * 路径一变就清空队列：带撤回的吐司随页面离开而结算（onDismiss），不会留到别的页面上、点了没用。
 */
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { subscribeToasts, toast, toastSnapshot } from "./toast-store";

const Toaster = lazy(() => import("./Toast").then((m) => ({ default: m.Toaster })));

export function ToastHost() {
  const has = useSyncExternalStore(subscribeToasts, () => toastSnapshot().length > 0);
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (has) setArmed(true); }, [has]);
  const { pathname } = useLocation();
  useEffect(() => () => toast.clear(), [pathname]);
  return armed ? <Suspense fallback={null}><Toaster /></Suspense> : null;
}
