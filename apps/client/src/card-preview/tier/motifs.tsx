/**
 * 卡面上的矢量纹样：全部是内联 SVG，没有位图。
 * - Waves：Lv1 一条海平线；Lv3+ 几道焦散水纹（静态）。
 * - Signature：Lv4 起每位角色一套专属纹样，意象沿用 CharacterMark：
 *   鲸汐 = 鲸尾掀起的水纹与气泡；大肥鱼 = 鲸喷的水柱与水珠；小克 = 翻飞的书页与茶气；小智 = 抽枝的藤叶。
 * - FoilLeaf：Lv5 鎏金箔的碎箔与折痕。
 */
import type { CharacterId } from "../../characters";

export function Horizon() {
  return (
    <svg className="acard__svg acard__horizon" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 10 H100" />
      <path className="acard__horizon-ripple" d="M34 14 Q50 17 66 14" />
    </svg>
  );
}

export function Caustics() {
  return (
    <svg className="acard__svg acard__caustics" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
      <path d="M-4 92 C14 86 26 98 44 92 S78 86 104 94" />
      <path d="M-4 104 C18 98 30 110 52 103 S84 98 104 106" />
      <path d="M-4 117 C12 112 34 122 54 116 S86 112 104 119" />
      <path className="acard__caustics-net" d="M8 22 Q18 16 26 24 T44 22 M58 14 Q66 22 76 16 T96 20 M14 44 Q26 38 34 46 M64 40 Q74 34 86 42" />
    </svg>
  );
}

function WhaleSignature() {
  return (
    <>
      {/* 鲸尾掀起的三圈水纹 */}
      <path className="sig-line" d="M18 118 Q50 108 82 118" />
      <path className="sig-line sig-line--soft" d="M8 126 Q50 112 92 126" />
      <path className="sig-line sig-line--faint" d="M0 134 Q50 118 100 134" />
      {/* 远处一枚小鲸尾 */}
      <path className="sig-fill" d="M80 104 C80.2 100 79.6 97.4 78.3 95.6 C76 95.6 73 94.6 70.4 91.6 C73.4 91.5 75.8 92 77.7 93.3 C78.7 93.3 79.3 92.6 79.6 91.6 C79.9 92.6 80.4 93.3 81.4 93.3 C83.3 92 85.7 91.5 88.7 91.6 C86.1 94.6 83.1 95.6 80.8 95.6 C79.6 97.4 79.1 100 80 104 Z" />
      {[[14, 96, 2.6], [22, 84, 1.8], [12, 72, 1.3], [28, 66, 2.1], [86, 74, 1.6], [90, 60, 1.1]].map(([x, y, r], i) => (
        <circle key={i} className="sig-bubble" cx={x} cy={y} r={r} />
      ))}
    </>
  );
}

function SpoutSignature() {
  return (
    <>
      {/* 水柱：两道向上散开的弧，顶端落下水珠 */}
      <path className="sig-line" d="M50 124 C48 104 40 92 26 84" />
      <path className="sig-line" d="M50 124 C52 104 60 92 74 84" />
      <path className="sig-line sig-line--soft" d="M50 124 C50 106 50 96 50 80" />
      {[[22, 78], [30, 70], [70, 70], [78, 78], [50, 72], [40, 64], [60, 64]].map(([x, y], i) => (
        <path key={i} className="sig-fill" d={`M${x} ${y - 3.4} C${x + 1.6} ${y - 1} ${x + 2.2} ${y} ${x + 2.2} ${y + 1} A2.2 2.2 0 0 1 ${x - 2.2} ${y + 1} C${x - 2.2} ${y} ${x - 1.6} ${y - 1} ${x} ${y - 3.4} Z`} />
      ))}
      <path className="sig-line sig-line--faint" d="M10 128 Q50 118 90 128" />
    </>
  );
}

function PageSignature() {
  return (
    <>
      {/* 两页翻飞的纸与一缕茶气 */}
      <path className="sig-fill sig-fill--soft" d="M12 98 L26 92 L30 106 L16 112 Z" />
      <path className="sig-line" d="M15 101 L26 96.6 M16.6 105 L27.4 100.8" />
      <path className="sig-fill sig-fill--soft" d="M72 86 L86 90 L82 104 L68 100 Z" />
      <path className="sig-line" d="M73 90 L84 93 M71.4 94.6 L82.4 97.6" />
      <path className="sig-line sig-line--soft" d="M50 128 C44 120 56 114 50 106 C44 98 56 92 50 84" />
      <path className="sig-line sig-line--faint" d="M8 130 Q50 122 92 130" />
    </>
  );
}

function SproutSignature() {
  return (
    <>
      {/* 两侧抽出的藤，叶子交错 */}
      <path className="sig-line" d="M6 132 C14 116 10 100 20 86 C26 78 24 70 30 62" />
      <path className="sig-line" d="M94 132 C86 116 90 100 80 86 C74 78 76 70 70 62" />
      {[[16, 104, -30], [22, 82, 20], [28, 66, -20], [84, 104, 30], [78, 82, -20], [72, 66, 20]].map(([x, y, r], i) => (
        <path key={i} className="sig-fill" transform={`rotate(${r} ${x} ${y})`} d={`M${x} ${y} C${x - 6} ${y - 1} ${x - 8} ${y - 6} ${x - 8} ${y - 9} C${x - 3} ${y - 9} ${x} ${y - 5} ${x} ${y} Z`} />
      ))}
    </>
  );
}

export function Signature({ character }: { character: CharacterId }) {
  return (
    <svg className="acard__svg acard__signature" viewBox="0 0 100 140" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {character === "whale" ? <WhaleSignature /> : character === "deepseek" ? <SpoutSignature /> : character === "claude" ? <PageSignature /> : <SproutSignature />}
    </svg>
  );
}

/** 鎏金箔：一张不规则碎箔拼成的底，几道浅折痕。坐标固定，截图可复现。 */
const FLAKES: ReadonlyArray<string> = [
  "0,0 22,0 18,14 0,18", "22,0 46,0 40,12 18,14", "46,0 70,0 66,16 40,12", "70,0 100,0 100,10 66,16",
  "0,18 18,14 24,34 0,40", "18,14 40,12 44,30 24,34", "40,12 66,16 62,36 44,30", "66,16 100,10 100,34 62,36",
  "0,40 24,34 20,58 0,62", "24,34 44,30 48,54 20,58", "44,30 62,36 70,56 48,54", "62,36 100,34 100,60 70,56",
  "0,62 20,58 26,82 0,86", "20,58 48,54 44,78 26,82", "48,54 70,56 74,80 44,78", "70,56 100,60 100,84 74,80",
  "0,86 26,82 22,104 0,110", "26,82 44,78 50,102 22,104", "44,78 74,80 70,104 50,102", "74,80 100,84 100,108 70,104",
  "0,110 22,104 28,126 0,140", "22,104 50,102 46,128 28,126", "50,102 70,104 76,124 46,128", "70,104 100,108 100,140 76,124",
  "0,140 28,126 46,128 40,140", "40,140 46,128 76,124 72,140", "72,140 76,124 100,140",
];

export function FoilLeaf() {
  return (
    <svg className="acard__svg acard__foil" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
      {FLAKES.map((points, i) => <polygon key={i} points={points} className={`foil-flake foil-flake--${i % 4}`} />)}
      <path className="foil-crease" d="M6 30 L34 26 L52 40 M60 70 L88 64 M12 96 L30 92 L44 110 M64 118 L92 112" />
    </svg>
  );
}
