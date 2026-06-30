# Cuboidy エディタ UX バックログ

5体のエージェントによる UX 監査(2026-06-30)の成果物。オーナーが挙げた6つの懸念と、
監査で新たに見つかった課題を、優先度ごとに整理したもの。各項目は「規模(S/M/L)・
対象ファイル・方針」を添えてあり、上から順に着手できる。

- **規模**: S = 数行〜1ファイル / M = 数ファイル＋ハンドラ / L = 新規サブシステム
- **由来**: `[#n]` = オーナーが挙げた懸念番号 / `[new]` = 監査での新規発見
- すべての変更は `dispatchEdit` を通せば undo/redo が無料で付く(`App.tsx:62-67`)

---

## P0 — 小粒な仕上げ(低リスク・即効) — ✅ 完了 (2026-06-30)

| ID | 課題 | 規模 | 対象 | 状態 |
|---|---|---|---|---|
| P0-1 `[#3]` | "File header (preserved on save)" 表示を削除。保存時に自動 round-trip するので無価値。未使用 `.notice.info`/`.notice pre` CSS も除去 | S | `App.tsx`, `styles.css` | ✅ |
| P0-2 `[#4]` | Parse error バナーをエディタ上部→下部へ。`border-bottom`→`border-top`。スクロール影響なし | S | `SourceEditor.tsx`, `styles.css` | ✅ |
| P0-3 `[new]` | アニメ編集パネルが manifest パースエラー時に無言で無効化。`PalettePanel`/`PartProperties` と同様の説明文を出す | S | `AnimationView.tsx`, `styles.css` | ✅ |
| P0-4 `[new]` | パースエラーの文言を "syntax error" に統一(旧「Parse error」「Manifest error」「Manifest parse error」混在) | S | `App.tsx`, `SourceEditor.tsx`, `FileTree.tsx`, `PartProperties.tsx`, `PalettePanel.tsx` | ✅ |
| P0-5 `[#4派生]` | エラーのあるファイルをツリーで**赤字表示**(VS Code 流)＋ライブ編集に追従。tooltip は補助化(ホバーでエラー内容)。再パース成功時に stale な `manifestError` をクリア | S | `FileTree.tsx`, `Sidebar.tsx`, `App.tsx`, `styles.css` | ✅ |

---

## P1 — タイムラインの精度・可視性 `[#2]` 系

| ID | 課題 | 規模 | 対象 |
|---|---|---|---|
| P1-1 `[#2]` | キーフレームドラッグの粗いスナップ。フレーム(既定30fps=0.033s)または固定0.05s。`Alt` で微調整バイパス。1e-3 は保存グリッドとして維持 | M | `Timeline.tsx:444-457` |
| P1-2 `[#2]` | ルーラーに目盛り＋時刻ラベル、レーンに薄いグリッド線(スナップ先を可視化)。今のルーラーは空 div | M | `Timeline.tsx:151-156`, `styles.css:1464-1472` |
| P1-3 `[new]` | 新規クリップで最初のキーを追加できない(全行が畳まれ `+` が隠れる)。空クリップは先頭パートを自動展開 | S | `Timeline.tsx:219-221`, `App.tsx:551` |
| P1-4 `[new]` | 横ズーム(pixels-per-second)＋横スクロール。密なキーが重なってクリック不能になる問題の根治 | M/L | `styles.css:1474-1482`, `Timeline.tsx:320` |
| P1-5 `[new]` | キーボード: 選択キーの `Delete`、`Space` で再生/停止、矢印で1フレームナッジ。IMEガードは既存パターン流用 | M | `App.tsx:723-750`, `Timeline.tsx` |
| P1-6 `[new]` | レーン背景クリックでスクラブ(/ダブルクリックでキー追加)。今は背景が死んでいる | S/M | `Timeline.tsx:320-344` |
| P1-7 `[new]` | duration 短縮で範囲外になったキーが右端に重なって不可視。扇状に広げる or バッジtooltipで個別選択 | S | `Timeline.tsx:501-503,526` |

---

## P2 — レイアウト / 情報設計 `[#5/#6]`

目標IA: **左カラム=cvox オーサリング群**(Files → Palette → Parts Tree → Properties)、
**右カラム=解放**(3Dビュー/タイムラインを拡幅、または rig 専用インスペクタに限定)。

| ID | 課題 | 規模 | 対象 |
|---|---|---|---|
| P2-1 `[#5]` | `PartProperties` を右パネル→左 Sidebar の Parts Tree 直下へ。選択→編集が1カラム内の縦移動に | M | `RightPanel.tsx:49-59` → `Sidebar.tsx` |
| P2-2 `[#6]` | `PalettePanel` を右パネル→左 cvox 群へ移動。右カラムから cvox 関心を排除 | M | `RightPanel.tsx:42-60` → `Sidebar.tsx` |
| P2-3 `[new]` | パレットを全タブ常時表示にせず、cvox 関連タブ時のみ表示(`PalettePanel.tsx:17-20`) | S | `RightPanel.tsx:44` |
| P2-4 `[new]` | パネル幅 260px 固定をリサイズ可能に(スプリッタ)。アニメビューでは左右を自動折り畳み | M | `styles.css:758,271` |
| P2-5 `[new]` | `ViewModeToggle`(Cvox/Rig/Anim)をヘッダ右→Preview ペイン上へ。`TabBar` と並べる | S | `App.tsx:787-794` |
| P2-6 `[new]` | "Create manifest" の入口が3箇所(`FileTree`/`PartProperties`/`Sidebar`)。Files 1箇所に集約 | S | `FileTree.tsx:43-51`, `PartProperties.tsx:64-71` |

---

## P3 — オーサリング機能 `[#1]` ＋ ジオメトリ

パーツの実体は `cvox.parts`(ジオメトリ)。manifest は rig メタのみで、未記載パーツも許容
(`part-tree.ts:31-39`)。名前は cvox/manifest/animation の**結合キー**なのでリネーム/削除は要整合。

| ID | 課題 | 規模 | 対象 |
|---|---|---|---|
| P3-1 `[#1]` | パーツ新規作成。`handleCreatePart`:デフォルト `Part`(1voxel)を `cvox.parts` に追加し `handleEditCvox` 経由。"+" は `Sidebar` Parts 節へ | M | `App.tsx`, `Sidebar.tsx:62-77` |
| P3-2 `[new]` | パーツ削除。cvox から除去＋manifest エントリ削除＋子の `parent` 再ルート＋animトラック削除を一括 | M | `App.tsx` |
| P3-3 `[new]` | パーツ複製(対称な手足の量産)。選択 `Part` をディープコピー＋一意名＋append。最安 | S/M | `App.tsx` |
| P3-4 `[new]` | パーツ リネーム。cvox名＋manifest.name/parent＋全 anim トラックキーを原子的に書換(クロスファイルトランザクション) | M/L | `App.tsx` |
| P3-5 `[new]` | size / pivot / socket 編集を `PartProperties` に追加(`handleEditCvox` 経由)。フル voxel painter の前段として高価値・低リスク | M | `PartProperties.tsx:21-23` |
| P3-6 `[new]` | パレット alpha 編集。`#RRGGBBAA` 対応済だが UI が RGB のみ(`hexToRgb` が a を捨てる) | S | `PalettePanel.tsx:143-150,187-193` |
| P3-7 `[new]` | clone/mirror パーツ再利用の UI(core は対応済 `serialize.ts:59-68`)。対称リグの本来の手段 | M | `PartTree`/`PartProperties` |
| P3-8 `[new]` | モデル `name`/`version` を UI で編集(今は JSON タブのみ) | S | `synthesize-manifest.ts:28-34` |
| P3-9 `[new]` | フル voxel ペインター(3D編集)。最大の欠落だが規模大・後回し可 | L | 新規 |

---

## P4 — 一貫性・アクセシビリティ・状態表示

| ID | 課題 | 規模 | 対象 |
|---|---|---|---|
| P4-1 `[既知]` | ボタンstyle乱立を `.btn` ベース＋6モディファイア(primary/secondary/danger/create/icon/warning)に集約。~16ブロック→1+6 | M | `styles.css` 全域 |
| P4-2 `[new]` | disabled 状態の統一(opacity 0.4/0.5/0.6 混在、`.anim-play` は `:disabled` 規則すら無し) | S | `styles.css:1191-1216` ほか |
| P4-3 `[new]` | dirty(未保存)インジケータ＋`beforeunload` ガード。今は編集しても "Save" のまま、離脱で無言破棄 | M | `SaveButton.tsx`, `history.ts` |
| P4-4 `[new]` | 保存/エクスポートのフィードバック統一(成功=地味な✓ / 失敗=`alert` / Export=無言)。共通ステータス帯へ | S | `SaveButton.tsx:33-45`, `ExportMenu.tsx:59-64` |
| P4-5 `[new]` | core の lint(`lintCvox`/`validateCrossFile`)をエディタに接続。pivot範囲外・未使用パレット等を下部ステータスに | M | `core/src/index.ts:53-55`, `App.tsx` 反映 |
| P4-6 `[new]` | `NumberInput`/`TextInput` の無効入力フィードバック＋理由表示(invalid識別子 vs 重複名)。`aria-invalid` | S | `NumberInput.tsx:60-69`, `TextInput.tsx:43-46` |
| P4-7 `[new]` | a11y: アイコンボタンに `aria-label`、swatch-delete の focus 表示、tablist の矢印移動/radiogroup化、低コントラスト(#555/#666)是正 | M | `Timeline`/`PalettePanel`/`ViewModeToggle`/`styles.css` |
| P4-8 `[new]` | tooltip の "SPEC §6.6" 等の内部参照を平易な日本語/英語へ | S | `Timeline.tsx:529`, `KeyInspector.tsx:56`, `AnimationView.tsx:389` |
| P4-9 `[new]` | `prefers-reduced-motion` ガード(再生が自動開始、flash/transition も)。`Space` 再生も併せて | S | `AnimationView.tsx:115,133-150` |
| P4-10 `[new]` | 破壊的操作(part-clear ×, delete-key, delete-color)の確認 or 取り消し導線の明示。今は Ctrl+Z 頼み | S | `Timeline.tsx:273-282` ほか |

---

## 推奨着手順

1. **P0**(即効・低リスク)→ 体感がすぐ良くなる
2. **P1**(タイムライン精度)→ `[#2]` を含むアニメ編集の中核改善
3. **P2**(レイアウト再編)→ `[#5/#6]`、関心分離。やや大きいので独立コミット推奨
4. **P3**(オーサリング)→ `[#1]` 含む機能拡張。作成→複製→削除→リネームの順が安全
5. **P4**(仕上げ)→ ボタン統一や a11y は token パスとしてまとめて

> 注: P3 のリネーム/削除と、cvox/manifest/animation の参照整合は最大の技術的リスク。
> source 手編集だと参照が静かに壊れる(dangling parent は黙って root 化、stale な anim
> トラックは黙って no-op)。これらは必ずクロスファイルトランザクションで実装すること。
