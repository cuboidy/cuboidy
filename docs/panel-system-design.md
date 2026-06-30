# ドック可能パネルシステム — 設計 & ロードマップ

エディタ UI を、**再帰分割(split tree)で配置するドック可能パネル**に作り替える設計。
Blender / VS Code / react-mosaic と同系統。**画面に“特別な中央本体”は無く、すべてがパネル**で、
ユーザーが分割・移動・タブ化・リサイズ・折りたたみ・永続化できる。

- 発端: UX バックログ(`docs/ux-backlog.md`)の **P2 レイアウト**(懸念 #5/#6)。
  固定レイアウトの組み替えではなく、配置をユーザーが制御できる仕組みへ拡張。
- 方針: **手組み**で段階実装(ミニマルな見た目を維持)。本格 D&D が必要なら最終段でライブラリ検討。

---

## 1. 動機

現状は3カラム固定で関心が散らばり、配置を変えられない:
- **#5** パーツ選択(左 `PartTree`)と編集(右 `PartProperties`)が遠い
- **#6** 右パネルで Palette(cvox)と Properties(rig)が縦に隣接(関心混在)
- パネル幅 260px 固定・リサイズ不可、anim ビューで左右が無駄、タイムラインは中央に束縛

固定配置の「最適解」は作業内容(cvox/rig/anim)や好みで変わる。**配置をユーザーが決められる**
仕組みにし、最適な**初期配置だけ**与える。

---

## 2. モデル:再帰 split ツリー

レイアウトは **分割ノードと葉(パネル)からなる木**。`left/right/bottom/center` のような固定ゾーンは
**存在しない** — それらは木の特殊形にすぎない。

- **SplitNode** … 方向(`row`=横並び / `col`=縦並び)＋ 子(2つ以上)＋ 各子の比率。子の境界に**スプリッタ**
- **LeafNode** … パネルの**タブグループ**(1枚以上、1枚がアクティブ)

```
ルート: row 分割 [ 左 | 中央 | 右 ]
                     └ 中央: col 分割 [ ビューポート(上) / タイムライン(下) ]

┌──────────┬───────────────────────┬─────────┐
│ Files    │ [Preview][cvox][json] │ Palette │  ← 横3分割(row)
│ ───────  │      3D viewport      │         │     各葉はタブグループ
│ Parts    │            〔cvox|rig|anim〕      │  ← Preview 固有ツールバー(右上)
│ ───────  ├───────────────────────┤         │
│ Property │      Timeline         │         │  ← 中央を col 分割(上=Viewport/下=Timeline)
└──────────┴───────────────────────┴─────────┘
   └ 左も col 3分割(Files/Parts/Property、スプリッタでリサイズ)
```

### 全部パネル + 共通枠
すべての中身(3Dビュー・ソース・タイムライン・Files…)は**同じ規格の `Panel` 枠**に載る:

```
┌─ タイトル ──────────────── ⋯ ─┐   ⋯=メニュー(閉じる/移動/分割/タブ化)
│ (本体)                        │     ※折りたたみは無し(後述)
└───────────────────────────────┘
複数パネルの葉 → タブ
┌─[ Preview ][ cvox ][ json ]─ + ⋯ ┐   + = パネル追加(未配置パネルを呼び戻す)
│ (アクティブタブの本体)            │
└───────────────────────────────────┘
```

### 葉のヘッダ = タブストリップ(タブ表示の仕組み)
タブ用の空間を**別に設けない**。**ヘッダ行そのものがタブストリップ**になる:

- 葉にパネルが **1枚** → ヘッダ = そのタイトル1つ(= A1 の現状の見た目。実質「タブ1枚」)
- 葉にパネルが **複数** → 同じヘッダ行に**各パネルのタイトルがタブとして並ぶ**。アクティブタブの
  本体・メタ・固有ツールバーを表示、クリックで切替

```
1枚:  ┌ PARTS                 3/5 ─┐
      │ ...body...                 │
複数: ┌ Properties │ Palette    ⋯ ┐   ← 同じ行にタブが並ぶ(余白は別取りしない)
      │ ...アクティブタブの本体...   │
```

→ タブ化時は **ヘッダの所有者が「パネル」から「葉(Leaf)」へ移る**。各パネルは
`{ title, meta, toolbar, body }` だけ提供し、**葉がタブストリップを組み立てて**アクティブな
1枚の中身を出す。A1 は「葉=常に1枚」なので `Panel` 自身がヘッダを持つ簡略形(Phase C で
所有権を葉へ移す)。

### パネル固有ツールバー
パネルは自分のヘッダ/隅に**専用操作**を出せる。「その操作が誰に属すか」を表現する:
- **Preview** … 右上にフローティングで `⟨cvox | rig | anim⟩`(描画モード切替)
- **Timeline** … ヘッダにクリップ選択・duration・loop

### 操作 = ツリーの組み替え
- **分割** … 葉を `SplitNode` に置換(その方向に2つの葉)
- **移動/タブ化** … 葉間でパネルを移す/合流(⋯メニュー、後段で D&D)
- **リサイズ** … スプリッタをドラッグ(`SplitNode.sizes` 更新)
- **閉じる** … パネルをツリーから外す。**折りたたみ(中身だけ隠す)は廃止** — ヘッダだけ残る空状態がかえって混乱の元、という判断
- **パネル追加** … 閉じた(未配置の)パネルを呼び戻す。各葉のタブ末尾の **+** か **View ▾** メニューでレジストリから選んで追加

### 永続化
ツリー全体(`Layout`)を **localStorage** に保存。コマンド「**レイアウトをリセット**」で初期配置へ。

---

## 3. データモデル

```ts
type SplitDir = 'row' | 'col';        // row=横並び, col=縦並び
type LayoutNode = SplitNode | LeafNode;

interface SplitNode {
  kind: 'split';
  dir: SplitDir;
  children: LayoutNode[]; // 2つ以上
  sizes: number[];        // 各子の比率(スプリッタでリサイズ)
}
interface LeafNode {
  kind: 'leaf';
  panels: PanelId[];      // タブ(順序付き, 1枚以上)
  active: PanelId;        // 表示中のタブ
}
type Layout = LayoutNode; // ルート1本 → localStorage に保存
```

### パネルレジストリ(中身と配置を分離)
```ts
type PanelId =
  | 'preview' | 'cvoxSource' | 'manifestSource' // ビューポート系
  | 'files' | 'parts' | 'properties' | 'palette' // ツール系
  | 'timeline' | 'keyInspector';                 // アニメ系

interface PanelDef {
  id: PanelId;
  title: string;
  render: (ctx: EditorContext) => ReactNode;
  toolbar?: (ctx: EditorContext) => ReactNode;   // パネル固有のヘッダ/オーバーレイ操作
  contextOk?: (ctx: EditorContext) => boolean;   // 文脈外なら空状態(自動では隠さない)
}
```
`contextOk` が false でも**自動で隠さず**、本体に空状態を出す(例: palette は cvox 未読込時
「cvox を読み込むと使えます」)。自動消失は「パネルが消えた?」の混乱を生むため。

**閉じたパネル** = レジストリにあるがツリーに無いもの。「パネル追加」UI(+/View メニュー)は
それらを一覧して、選んだ葉/スロットに挿入する。

### アニメーション共有状態(§4 参照)
```ts
interface AnimationSession {
  activeClip: string | null;
  time: number;
  playing: boolean;
  selectedKey: SelectedKey | null;
}
```

### 初期配置(= 練り直した推奨 IA をツリーで表現)
```ts
const initialLayout: Layout = {
  kind: 'split', dir: 'row', sizes: [0.2, 0.6, 0.2], children: [
    // 左: Files / Parts / Properties+KeyInspector を縦3分割
    { kind: 'split', dir: 'col', sizes: [0.3, 0.4, 0.3], children: [
      { kind: 'leaf', panels: ['files'], active: 'files' },
      { kind: 'leaf', panels: ['parts'], active: 'parts' },
      { kind: 'leaf', panels: ['properties', 'keyInspector'], active: 'properties' },
    ]},
    // 中央: 上=ビューポート(3D/ソースをタブ), 下=タイムライン
    { kind: 'split', dir: 'col', sizes: [0.7, 0.3], children: [
      { kind: 'leaf', panels: ['preview', 'cvoxSource', 'manifestSource'], active: 'preview' },
      { kind: 'leaf', panels: ['timeline'], active: 'timeline' },
    ]},
    // 右: Palette 単独(rig から分離 → #6)
    { kind: 'leaf', panels: ['palette'], active: 'palette' },
  ],
};
```
- 左: Parts(選択)と Properties が縦に近い → **選択→編集が近い**(#5)
- 右: Palette 単独 → **rig と物理分離**(#6)
- 中央下: Timeline(= 旧「bottom」の正体は中央の col 分割)

---

## 4. アニメーションの概念整理(セッション分離)

今は `AnimationView` が「3D・タイムライン・再生状態」を全部抱え、タイムラインがアニメビューに
束縛されている。これを**共有状態 `AnimationSession` を介してつなぐ**形にほどく:

```
        ┌──────────────────────────────┐
        │  AnimationSession(共有state) │
        │  activeClip/time/playing/sel │
        └──────────────────────────────┘
          ▲ 編集            ▲ 参照(描画)
   ┌──────┴──────┐    ┌─────┴──────────┐
   │ Timeline    │    │ Preview        │
   │ パネル       │    │ (cvox/rig/anim)│
   │ (+KeyInsp)  │    │                │
   └─────────────┘    └────────────────┘
```

- **Timeline パネル** … セッションを**編集**(クリップ選択/スクラブ/キー編集)。普通のパネル
- **Preview パネル** … セッションを**参照**して anim 描画
- 連動: **Timeline を操作したら Preview を自動で anim 描画**(触ったら動きが見える)
- `anim` は特別ビューではなく「**Preview がセッションのポーズを描いている状態**」と定義
- クリップが無ければ Timeline 本体に「**+ アニメーションを作成**」の空状態(旧 anim 空状態をパネル内へ)

---

## 5. ロードマップ(各段階で動作確認 → コミット)

| 段階 | 内容 | 主な対象 | 規模 |
|---|---|---|---|
| **A. 共通パネル枠 + 固有ツールバー** | `Panel` コンポーネント(統一ヘッダ:タイトル + メタ + 固有ツールバー枠 + 本体。**折りたたみ無し**)を作り、既存ツールパネル(Files/Parts/Properties/Palette)を載せ替え。**cvox/rig/anim を Preview 右上のフローティングへ**移設。CSS 統一(P4-1 と相性良)。**配置は現状のまま** | 新規 `Panel.tsx`、各パネル、`App.tsx`、`styles.css` | M |
| **B. 再帰 split エンジン + リサイズ** | `LayoutNode` ツリーを描画する `Dock`(split の入れ子 + スプリッタ)。まずツール系パネルを **初期配置**で並べる(中央は当面 現状の TabBar 流用)。`SplitNode.sizes` をリサイズ・保存 | 新規 `Dock.tsx`/`lib/layout.ts`、`App.tsx` | M |
| **C. タブ + 移動/分割/閉じる/追加 + 永続化** | 葉のタブ化。⋯メニューで「移動 / 分割 / タブ化 / 並べ替え / 閉じる」、**+/View メニューで閉じたパネルを追加** = ツリー組み替え。`Layout` 全体を localStorage 保存。「レイアウトをリセット」 | `Dock`、`lib/layout.ts` | M |
| **D. 中央もパネル化 + アニメセッション分離** | Preview / cvoxSource / manifestSource / Timeline / KeyInspector を**パネル化**し、中央も split ツリーに統合(= 全部パネル)。`AnimationSession` を App へ持ち上げ、Preview と Timeline で共有(§4) | `App.tsx`、`AnimationView` 解体、新パネル群 | **L(最大)** |
| **E. ドラッグ&ドロップ(任意)** | ヘッダ/タブをドラッグして分割線へドロップ。手組みが辛ければ **dockview** 等に置換も検討 | — | L |

**進め方:A → B → C → D を手組みで段階実装**。各段階を単独コミット、動作確認してから次へ。
D(中央パネル化+セッション分離)が最大の山。E は D まで使ってみて必要なら。

### 各段階の完了条件(目安)
- **A**: 全ツールパネルが同一ヘッダ(タイトル+メタ+固有ツールバー、折りたたみ無し)。Preview 右上に cvox/rig/anim。配置は不変
- **B**: 初期配置が再帰 split で描画され、スプリッタでリサイズ&保存できる。#5/#6 解消
- **C**: パネルを移動・分割・タブ化・**閉じる/追加**でき、再読込後も配置保持。リセット可
- **D**: ビューポート/ソース/タイムラインもパネルとして自由配置。アニメは Preview+Timeline がセッション共有で連動
- **E**: ドラッグでパネルをドッキングできる

---

## 6. 確定した方針

- **手組み**(A〜D)で進める。**D&D(E)で辛ければ dockview** 等を検討
- **モード連動**: 自動で隠さず `contextOk` で空状態表示
- **Properties の中身**: 選択パーツの **cvox(size/pivot)+ rig(parent/pos)を常に両方**グループ表示
- **cvox/rig/anim**: Preview パネル固有のフローティングツールバー(所属を明示)

---

## 7. 非対象(やらないこと)

- フローティングウィンドウ / 別モニタへの切り離し
- (再帰分割は**中核**であり対象)

---

## 8. バックログとの関係

- 本設計は `docs/ux-backlog.md` の **P2** を置換・拡張(固定レイアウト → 再帰 split ドック)
- **P2-4(パネルリサイズ)** は Phase B に内包
- **P4-1(ボタン/スタイル token 統一)** は Phase A の共通枠 CSS と一緒に
- **P4-3 ほか** の status/lint は、将来パネル(例: 診断パネル)として葉に追加可能
