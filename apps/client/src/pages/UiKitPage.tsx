import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Button, Card, CardButton, ConfirmDialog, Dialog, Field, IconButton, Input, Select, Switch, TabPanel, Tabs, Textarea,
  ToastPreview, Toaster, Tooltip, toast,
} from "../components/ui";
import { Icon } from "../icons";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";
import { applyA11y, readA11y } from "../lib/a11y";
import "./UiKitPage.css";

/**
 * 隐藏预览页 `/__kit`（#151）：设计 token 与 components/ui 全部组件、全部状态。
 * 顶部切主题 / 角色 / 老人模式；`?open=dialog|confirm|select|tooltip` 打开对应弹层，给截图用。
 * 由 App 里 React.lazy 加载，不进首屏。旧的手绘基元样品页移到 `/__kit/ink`。
 */
const CHARACTERS = [
  { id: "whale", name: "鲸汐" },
  { id: "deepseek", name: "大肥鱼" },
  { id: "claude", name: "小克" },
  { id: "chatgpt", name: "小智" },
] as const;

const VARIANTS = [
  ["primary", "主按钮", "保存"],
  ["secondary", "次按钮", "导出"],
  ["ghost", "幽灵按钮", "稍后"],
  ["danger", "危险按钮", "删除"],
] as const;
const STATES = [
  ["default", "默认"],
  ["hover", "悬停"],
  ["active", "按下"],
  ["focus", "键盘焦点"],
  ["disabled", "禁用"],
  ["loading", "加载中"],
] as const;

const COLORS: Array<[string, string]> = [
  ["--color-bg-body", "整页底"], ["--color-bg-muted", "凹陷"], ["--color-surface", "分区"], ["--color-card", "卡片"], ["--color-popover", "弹层"],
  ["--color-text-primary", "正文"], ["--color-text-secondary", "次要"], ["--color-text-tertiary", "说明"], ["--color-text-disabled", "禁用"],
  ["--color-border", "分隔线"], ["--color-border-strong", "控件边"], ["--color-accent", "强调（角色）"], ["--color-accent-muted", "强调浅底"],
  ["--color-success", "成功"], ["--color-warning", "提醒"], ["--color-error", "错误"], ["--color-info", "信息"],
];
const TYPE = ["display", "3xl", "2xl", "xl", "lg", "md", "sm", "xs"];
const RADII = ["inner", "element", "container", "page", "full"];
const ELEV = ["flat", "raised", "floating", "overlay"];
const MOTION: Array<[string, string]> = [["--dur-fast", "hover、按下、开关"], ["--dur-medium", "弹层、吐司、标签"], ["--dur-slow", "对话框、抽屉"]];

const VOICES = [
  { value: "soft", label: "温柔" },
  { value: "bright", label: "明快" },
  { value: "calm", label: "沉稳" },
  { value: "old", label: "旧的声音（已下线）", disabled: true },
];

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="uikit__section" aria-labelledby={`uikit-${id}`}>
      <h2 id={`uikit-${id}`}>{title}</h2>
      {note ? <p className="uikit__note">{note}</p> : null}
      {children}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <Button variant={active ? "primary" : "ghost"} aria-pressed={active} onClick={onClick}>{children}</Button>;
}

export default function UiKitPage() {
  const [params] = useSearchParams();
  const pinned = params.get("open");
  const [character, setCharacter] = useState(() => document.documentElement.getAttribute("data-character") || "whale");
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [elder, setElder] = useState(() => readA11y().elder);
  const [dialog, setDialog] = useState(pinned === "dialog");
  const [confirm, setConfirm] = useState(pinned === "confirm");
  const [sw, setSw] = useState(true);
  const [voice, setVoice] = useState("soft");

  useEffect(() => { document.documentElement.setAttribute("data-character", character); }, [character]);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const prev = readA11y();
    applyA11y({ ...prev, elder });
    return () => applyA11y(prev);
  }, [elder]);

  return (
    <div className="uikit">
      <header className="uikit__bar" aria-label="预览设置">
        <h1>设计系统 · 组件预览</h1>
        <div className="uikit__group" role="group" aria-label="角色">
          {CHARACTERS.map((c) => <Chip key={c.id} active={character === c.id} onClick={() => setCharacter(c.id)}>{c.name}</Chip>)}
        </div>
        <div className="uikit__group" role="group" aria-label="主题">
          {(["light", "dark"] as const).map((t) => <Chip key={t} active={theme === t} onClick={() => setTheme(t)}>{t === "light" ? "白天" : "夜里"}</Chip>)}
        </div>
        <Switch label="老人模式" checked={elder} onCheckedChange={setElder} />
        <span className="uikit__label" aria-hidden="true">老人模式</span>
      </header>

      <Section id="buttons" title="按钮" note="四种外观 × 六种状态。悬停、按下、焦点三列是钉住的状态，便于对照；真实交互里 hover 只在精确指针下出现，按下微缩在触屏与安静模式下关闭。">
        <div className="uikit__matrix" role="table" aria-label="按钮状态">
          <div role="row" className="uikit__row uikit__row--head">
            <span role="columnheader" />
            {STATES.map(([, label]) => <span role="columnheader" key={label}>{label}</span>)}
          </div>
          {VARIANTS.map(([v, name, text]) => (
            <div role="row" className="uikit__row" key={v}>
              <span role="rowheader" className="uikit__rowhead">{name}</span>
              {STATES.map(([s]) => (
                <span role="cell" key={s}>
                  <Button
                    variant={v}
                    disabled={s === "disabled"}
                    loading={s === "loading"}
                    data-preview={s === "hover" || s === "active" || s === "focus" ? s : undefined}
                  >
                    {text}
                  </Button>
                </span>
              ))}
            </div>
          ))}
          <div role="row" className="uikit__row">
            <span role="rowheader" className="uikit__rowhead">图标按钮</span>
            {STATES.map(([s]) => (
              <span role="cell" key={s}>
                <IconButton
                  label="新对话"
                  disabled={s === "disabled"}
                  loading={s === "loading"}
                  data-preview={s === "hover" || s === "active" || s === "focus" ? s : undefined}
                >
                  <Icon name="new" />
                </IconButton>
              </span>
            ))}
          </div>
        </div>
        <div className="uikit__line">
          <Button variant="primary" size="lg" icon={<Icon name="send" />}>大号主按钮</Button>
          <Button variant="secondary" icon={<Icon name="export" />}>带图标</Button>
          <IconButton label="更多" variant="secondary"><Icon name="more" /></IconButton>
          <Tooltip content="开始新的对话" open={pinned === "tooltip" ? true : undefined}>
            <IconButton label="新对话"><Icon name="new" /></IconButton>
          </Tooltip>
        </div>
      </Section>

      <Section id="fields" title="输入框与下拉">
        <div className="uikit__grid">
          <Field label="昵称" hint="她会这样叫你"><Input placeholder="比如：阿翔" /></Field>
          <Field label="悬停"><Input defaultValue="鲸汐" data-preview="hover" /></Field>
          <Field label="聚焦"><Input defaultValue="鲸汐" data-preview="focus" /></Field>
          <Field label="出错" error="名字最多 12 个字，现在是 15 个"><Input defaultValue="一个特别特别长的名字啊啊啊" /></Field>
          <Field label="禁用" hint="登录后才能改" disabled><Input defaultValue="鲸汐" /></Field>
          <Field label="声音"><Select value={voice} onValueChange={setVoice} options={VOICES} /></Field>
          <Field label="未选择"><Select options={VOICES} placeholder="选一个声音" /></Field>
          <Field label="禁用的下拉" disabled><Select options={VOICES} defaultValue="calm" /></Field>
          <Field label="写给她的话" className="uikit__wide"><Textarea placeholder="今天想说点什么？" /></Field>
        </div>
        {pinned === "select" ? (
          <div className="uikit__pinned">
            <Field label="展开的下拉"><Select options={VOICES} defaultValue="bright" open /></Field>
          </div>
        ) : null}
      </Section>

      <Section id="switches" title="开关">
        <div className="uikit__line">
          <span className="uikit__pair"><Switch label="自动朗读" checked={sw} onCheckedChange={setSw} /><span aria-hidden="true">自动朗读</span></span>
          <span className="uikit__pair"><Switch label="关着" checked={false} /><span aria-hidden="true">关着</span></span>
          <span className="uikit__pair"><Switch label="悬停" checked data-preview="hover" /><span aria-hidden="true">悬停</span></span>
          <span className="uikit__pair"><Switch label="键盘焦点" checked data-preview="focus" /><span aria-hidden="true">键盘焦点</span></span>
          <span className="uikit__pair"><Switch label="禁用" checked disabled /><span aria-hidden="true">禁用</span></span>
        </div>
      </Section>

      <Section id="tabs" title="标签页">
        <Tabs label="日记分类" items={[{ value: "all", label: "全部" }, { value: "mine", label: "我写的" }, { value: "hers", label: "她写的" }, { value: "x", label: "已归档", disabled: true }]}>
          {/* 故意包一层 Fragment：ui-check 第 16 项靠它确认包起来的面板也有 aria-controls */}
          <>
            <TabPanel value="all"><p className="uikit__note">下划线样式：页面级分区。</p></TabPanel>
            <TabPanel value="mine"><p className="uikit__note">我写的日记。</p></TabPanel>
          </>
          <TabPanel value="hers"><p className="uikit__note">她写的日记。</p></TabPanel>
        </Tabs>
        <Tabs label="视图" variant="segmented" items={[{ value: "day", label: "按天" }, { value: "week", label: "按周" }, { value: "month", label: "按月" }]} />
      </Section>

      <Section id="cards" title="卡片">
        <div className="uikit__cards">
          <Card><h3>平铺</h3><p className="uikit__note">一组设置、一条记忆。</p></Card>
          <Card variant="raised"><h3>浮起</h3><p className="uikit__note">需要被注意的一块。</p></Card>
          <CardButton><h3>可点</h3><p className="uikit__note">整块是一个按钮。</p></CardButton>
          <CardButton data-preview="hover"><h3>可点 · 悬停</h3><p className="uikit__note">上浮 2px，阴影淡入。</p></CardButton>
          <CardButton data-preview="focus"><h3>可点 · 焦点</h3><p className="uikit__note">键盘走到这里。</p></CardButton>
        </div>
      </Section>

      <Section id="overlays" title="对话框、吐司、提示">
        <div className="uikit__line">
          <Button onClick={() => setDialog(true)}>打开对话框</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>删除这篇日记…</Button>
          <Button variant="ghost" onClick={() => toast({ title: "已导出到「下载」", tone: "success" })}>弹一条吐司</Button>
          <Button variant="ghost" onClick={() => toast({ title: "已删除 1 条记忆", action: { label: "撤销", onClick: () => toast({ title: "已撤销" }) } })}>带撤销的吐司</Button>
        </div>
        <div className="uikit__toasts">
          <ToastPreview title="已保存" />
          <ToastPreview title="已导出到「下载」" tone="success" />
          <ToastPreview title="网络有点慢" description="消息会在连上后发出" tone="warning" />
          <ToastPreview title="已删除 1 条记忆" tone="error" action={{ label: "撤销", onClick: () => {} }} />
        </div>
      </Section>

      <Section id="tokens" title="设计 token" note="组件只用语义层（--color-* / --text-* / --r-* / --elev-* / --dur-*）；纸墨调色板留给页面装饰。">
        <h3 className="uikit__h3">颜色</h3>
        <div className="uikit__swatches">
          {COLORS.map(([v, name]) => (
            <figure key={v} className="uikit__swatch">
              <div className="uikit__chip" style={{ background: `var(${v})` }} />
              <figcaption>{name}<br /><code>{v.replace("--color-", "")}</code></figcaption>
            </figure>
          ))}
        </div>
        <h3 className="uikit__h3">字号（base 16 × 1.125）</h3>
        <div className="uikit__type">
          {TYPE.map((t) => <p key={t} style={{ fontSize: `var(--text-${t})` }}><code>--text-{t}</code> 今天的浪很轻</p>)}
        </div>
        <h3 className="uikit__h3">圆角与层级</h3>
        <div className="uikit__line">
          {RADII.map((r) => <div key={r} className="uikit__shape" style={{ borderRadius: `var(--r-${r})` }}><code>{r}</code></div>)}
        </div>
        <div className="uikit__line">
          {ELEV.map((e) => <div key={e} className="uikit__shape uikit__shape--elev" style={{ boxShadow: `var(--elev-${e})` }}><code>{e}</code></div>)}
        </div>
        <h3 className="uikit__h3">动效</h3>
        <ul className="uikit__motion">
          {MOTION.map(([v, use]) => <li key={v}><code>{v}</code> {use}</li>)}
          <li><code>--ease-standard / enter / exit</code> 只动 transform 与 opacity；安静模式和减少动态效果下时长 1ms、位移归零</li>
        </ul>
      </Section>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="给她改个名字"
        description="新名字会在下一次对话时生效。"
        footer={<><Button variant="secondary" onClick={() => setDialog(false)}>取消</Button><Button variant="primary" onClick={() => setDialog(false)}>保存</Button></>}
      >
        <Field label="名字" hint="最多 12 个字"><Input defaultValue="鲸汐" /></Field>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title="删除这篇日记？"
        description="删除后找不回来。她写的回信也会一起删掉。"
        confirmLabel="删除日记"
        onConfirm={() => { toast({ title: "已删除", tone: "error" }); }}
      />
      <Toaster />
    </div>
  );
}
