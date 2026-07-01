# プロジェクトファイル構成 (SPEC v0.7) — 設計 & ロードマップ

複数 .cvox / 外部パレット / 外部アニメーション / エディタのファイル CRUD。
2026-07-02 の設計会話の成果物。panel-system-design.md と同じ流儀で、
決定事項 → データモデル → フェーズ分けロードマップの順。

## 1. 動機

現状の制約と、それが生む問題:

- **ファイル名固定**: モデル = `voxels.cvox` + `cuboidy.json` の2ファイルきっかり。
  ローダーもこの2名をハードコードで拾う(`load-model.ts`)。
- **パレットが .cvox 必須**: 各 .cvox が自前のパレットを持たねばならず(§7.2
  "exactly one")、共有できない。ジオメトリを複数ファイルに割った瞬間、全ファイルで
  同じパレットをコピペ・同期修正する羽目になる。**これが今回の起点になった欠陥。**
- **アニメーションが manifest にインライン**: 仕様上は外部参照(§6.3 の文字列値)が
  既定済みだが、エディタが未実装。モデル間でアニメを共有する道が事実上ない。
- **ファイルツリーが表示専用**: フォルダ/ファイルの作成・リネーム・削除ができない。

望む姿: VS Code のようにフォルダ構成を自由に編集でき、ジオメトリ・パレット・
アニメーションが「参照で束ねる差し替え可能なリソース」になる。

```
wolf/
├── cuboidy.json          ← アンカー(唯一の固定名)。全リソースをここから参照
├── palette.json          ← 共有パレット
├── body.cvox             ← ジオメトリは自由な名前で複数可
├── gear/hat.cvox
└── anims/
    ├── walk.json         ← 外部アニメーション(仕様は v0.6 で既定済み)
    └── idle.json
```

## 2. 決定事項(= SPEC v0.7 ドラフト差分)

### 2.1 エントリポイントは `cuboidy.json` 固定のまま

フォルダを開いたとき「どれがマニフェストか」を決定論的に見つける入口は1つ必要
(glTF の `.gltf`、npm の `package.json` と同じ理屈)。それ以外のファイル名は
すべて参照で繋がるので自由になる。`voxels.cvox` という固定名は既定値としてのみ残る。

### 2.2 複数 .cvox — manifest の `geometry` 明示リスト + 未参照 lint

```json
{ "name": "wolf",
  "geometry": ["body.cvox", "gear/hat.cvox"],
  "palette": "palette.json",
  "parts": [ ... ],
  "animations": { ... } }
```

- `geometry`: §8 の参照パス規則(相対・拡張子明示・`/` 区切り)を `.cvox` にも拡張。
  省略時は `["voxels.cvox"]` — 既存モデルは無変更で valid(後方互換)。
- **パーツ名前空間はモデル全体で一意**(§5 の "unique within a model" がそのまま
  効く)。ファイル横断の重複名はクロスファイル error。`clone` / `mirror` の参照も
  モデル全体で解決される(ファイルをまたいでよい)。
- **lint**: フォルダ内に .cvox があるのに `geometry` から参照されていない →
  warning(新 W コード)。「置いたのに反映されない」事故を拾う。参照される
  ファイルだけがモデルの一部、という §3 の原則は維持。

### 2.3 パレットのハイブリッド化(インライン or 外部束縛)

- `.cvox` の `palette` 宣言を **"exactly one" → "at most one"** に緩和
  (§7.2 / §7.4 変更)。
- 外部パレットファイル(スキーマは最小限、拡張余地のためオブジェクト形):

```json
{ "colors": ["#1a1a1a", "#f4c9a0", "#RRGGBBAA", ...] }
```

  色文法・最大62色・インデックス割当(`0-9a-zA-Z`)は §7.4 と同一。
- manifest トップレベルの `"palette": "<path>.json"`(任意)が**全 geometry に効く**。
  束縛の粒度は当面モデル全体で1つ。ファイル別束縛(`geometry` エントリの
  オブジェクト形式)は必要になったら拡張。
- **優先順位: manifest 束縛 > .cvox インライン**。シャドーされたインライン
  パレットは lint hint。この向きにするのは「同じ .cvox 群に別 palette.json を
  束ねるだけで色違いモデル(スキン)が作れる」ため — 外部アニメと同じ
  「差し替え可能リソース」の構図に揃う。
- どこにもパレットが解決できないのに voxels が色インデックスを使う →
  クロスファイル error。インデックス範囲チェックは per-file lint から
  クロスファイル検証へ移る(束縛先のパレット長に依存するため)。
- インラインパレット付き .cvox は従来どおり単体で自己完結(手書きループ・
  単体ロード・単体配布は無傷)。manifest 必須化は起きない。

### 2.4 外部アニメーション — 仕様は既定済み、エディタ実装が本体

§6.3(文字列値 = アニメ1個入り JSON への相対パス)・§8(パス規則)・
§6.8(存在しないパーツは黙ってスキップ = リグ間共有の根拠)は v0.6 のまま使う。
やることはエディタ側:

- ローダーが参照を解決して読み込む(循環は §8 どおり error)
- タイムラインでインラインと同様に編集(保存先が別ファイルになるだけ)
- 「このクリップを外部化」(inline → `anims/<name>.json` に切り出し、manifest は
  文字列参照に置換)と、その逆の「インライン化」アクション

### 2.5 開く単位 — 段階導入

エディタが開く単位は当面「1モデルのフォルダ」のまま。ただし内部表現(§3)を
最初から「ファイルツリー + manifest 起点の参照解決」に一般化しておき、
ワークスペース(親フォルダを開いて複数モデル + shared/ を扱う)は
その上に将来載せる。`../` のパッケージ外参照は、FSA の権限がフォルダ単位である
以上ワークスペースなしには読めないため、当面はエディタではエラー表示。

## 3. データモデル(エディタ)

`LoadedSource` の全面改修が今回の実装の本体。現在の
「cvoxFile / manifestFile の2枚固定 + それぞれの AST」から:

```ts
interface ProjectSource {
  kind: 'folder' | 'cvox-only';        // cvox-only は単体ファイルロード(従来どおり)
  folderName: string;
  handle?: FileSystemDirectoryHandle;
  files: Map<string, FileEntry>;        // path → { text } — フォルダの全ファイル
  manifest?: Manifest;                  // cuboidy.json の解析結果
  geometries: Map<string, Cvox>;        // geometry で参照された .cvox の解析結果
  palette?: ResolvedPalette;            // 束縛解決済み(出所: inline | external)
  animations: Map<string, ResolvedAnim>; // 外部参照解決済み
  errors: Map<string, string>;          // path → 解析エラー(Console パネルへ)
}
```

- **参照解決層**を1モジュールに集約(パス正規化・循環検出・出所の記録)。
- dirty 管理・保存(FSA writeback / ZIP)は **per-file** に一般化。
- パネルは固定の `cvox` / `manifest` から **`file:<path>` の動的 ID** に拡張
  (`LeafId` 型の拡張)。ファイルツリーのクリックで任意ファイルのエディタタブが
  開く。テキストエディタは拡張子で出し分け(.cvox / .json)。
- 編集パイプライン(`dispatchEdit` + デバウンス再パース)はファイル単位に一般化。
  undo/redo は従来どおり history reducer に乗る。

## 4. ロードマップ(各段階で動作確認 → コミット)

| Phase | 内容 | 主な対象 |
|---|---|---|
| **A** | core: palette 省略可("at most one")・palette.json スキーマ・manifest `geometry`/`palette` フィールド・クロスファイル検証(重複パーツ名 / palette 解決 / インデックス範囲 / 未参照 .cvox)。**SPEC.md を v0.7 に改版するのはこのフェーズ** | `core/src/cvox/*`, `manifest.ts`, SPEC.md |
| **B** | loader/データモデル: フォルダ全走査(全ファイル取り込み)、`ProjectSource` 化、参照解決層。**UI は従来と同等の表示を維持**(見た目の変化なしで土台を差し替える) | `load-model.ts`, `types.ts`, `App.tsx`, `save.ts` |
| **C** | multi-cvox の表示/編集: 結合レンダリング、パーツツリーのファイル横断表示(所属ファイルの区別)、動的ファイルタブ(`file:<path>` パネル) | `layout.ts`, `Dock`, `PartTree`, `SourceEditor` |
| **D** | ファイル CRUD: ツリーで新規ファイル/フォルダ・リネーム・削除(パーツツリーの inline draft パターン流用)。`geometry`/参照の自動追随、save/export の per-file 化 | `FileTree`, `App.tsx`, `save.ts` |
| **E** | 外部アニメーション: 参照解決 → タイムライン編集 → 「外部化/インライン化」アクション | `useAnimationSession`, `TimelinePanel`, core |
| **F** | パレット共有 UI: palette.json の編集(既存 PalettePanel を束縛先に接続)、束縛の付け替え | `PalettePanel`, `PartProperties` |

順序の理由: A/B が全フェーズの土台(A は core だけで完結しテスト可能、B は
見た目を変えずに差し替えるので回帰確認が楽)。C 以降はユーザー価値の出る順で、
それぞれ独立にコミットできる。

## 5. 確定した方針(要約)

- アンカーは `cuboidy.json` 固定。他のファイル名はすべて自由(参照で繋ぐ)
- 複数 .cvox は `geometry` 明示リスト + 未参照 warning(自動検出はしない)
- パレットはハイブリッド: .cvox インライン(省略可) / manifest 束縛が優先
- 外部アニメは v0.6 仕様のままエディタ実装で対応
- 開く単位は1モデルフォルダ。内部表現だけ先にワークスペース対応形にしておく

## 6. 非対象(やらないこと)

- ワークスペース(複数モデル・shared/ の横断)— 将来。§3 のデータモデルは妨げない
- `../` パッケージ外参照のエディタ対応 — ワークスペースと同時(当面エラー表示)
- ファイル別パレット束縛・名前付きカラー・62色超(multi-char index)— 必要になったら
- パレットのバージョニング/継承のような高機能 — 想定しない

## 7. バックログとの関係

- P3-7(clone/mirror UI)は multi-cvox と独立に進められる(現ブランチの主題)
- P4-5(core lint のエディタ接続)は Phase A のクロスファイル検証 + Console パネル
  に自然に合流する
- P2-6(Create manifest 集約)は Phase D のファイル CRUD で入口ごと再設計される
