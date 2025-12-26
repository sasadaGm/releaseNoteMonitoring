# SDK/Release Monitor

技術リリース・障害・重要ニュース監視システム

## 目的

Firebase、AWS、PHP、iOS/Android SDKなどの更新情報を自動監視し、重要度を判定してSlackに通知します。

### 監視対象

- **インフラ系**: Amazon Linux, AWS Aurora MySQL, Memcached, OpenSSL
- **サーバ系**: Laravel, FuelPHP, PHP, SendGrid, Polygon.io, カブコムAPI, EDINET API, OpenAI API
- **アプリ系**: Xcode, iOS, Android Studio, Firebase iOS/Android, Adjust SDK, 各種Androidライブラリ

詳細は `config/sources.json` を参照してください。

## 機能

- 週次自動実行（毎週月曜 10:00 JST）
- ルールベースの重要度判定（Critical/High/Medium/Low）
- 差分検知（前回実行からの新規項目のみ通知）
- Slack通知（重要度別サマリ + 推奨アクション）
- 初回実行時は通知せずキャッシュ初期化のみ実施

## セットアップ

### 1. GitHub Secrets設定

リポジトリの Settings > Secrets and variables > Actions で以下を設定：

```
SLACK_WEBHOOK_URL: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### 2. 監視対象の追加・編集

`config/sources.json` を編集：

```json
{
  "sources": [
    {
      "id": "unique-id",
      "name": "表示名",
      "category": "infrastructure|server|app",
      "type": "rss|github|html",
      "url": "監視URL",
      "severityHint": "critical|high|medium|low",
      "enabled": true
    }
  ]
}
```

#### sourceタイプ

- **rss**: RSSフィードから取得
- **github**: GitHub Releases APIから取得（`url`は`owner/repo`形式）
- **html**: HTMLページから簡易的に抽出（見出しとリンク）
- **reference**: 参考リンクのみ（監視なし）

### 3. ローカルテスト

```bash
cd monitor

# ドライラン（Slack通知なし）
DRY_RUN=true node run.js

# 実際に通知（要SLACK_WEBHOOK_URL）
SLACK_WEBHOOK_URL="your-webhook-url" node run.js

# キャッシュ統計表示
node run.js stats
```

## 実行方法

### 自動実行（週次）

GitHub Actionsで毎週月曜 10:00 JST（01:00 UTC）に自動実行されます。

### 手動実行

1. リポジトリの **Actions** タブを開く
2. **SDK/Release Monitor** ワークフローを選択
3. **Run workflow** をクリック
4. オプション設定：
   - `dry_run`: `true` を選択すると通知せずテスト実行

## 重要度判定ロジック

### Critical
- セキュリティ脆弱性、CVE
- リモートコード実行
- サービス停止
- 証明書期限切れ
- 強制アップグレード
- End-of-Life (EOL)

**キーワード例**: `security`, `vulnerability`, `CVE-`, `remote code execution`, `outage`, `forced upgrade`, `end-of-life`

### High
- Breaking Change
- 非推奨化（期限付き）
- 必須対応
- メジャーバージョンアップ
- API削除
- 価格改定

**キーワード例**: `breaking change`, `deprecated`, `removal`, `required action`, `must upgrade`, `major version`, `pricing change`

### Medium
- マイナーバージョンアップ
- 新機能
- パフォーマンス改善
- バグ修正
- 既知の問題（回避策あり）

**キーワード例**: `minor version`, `new feature`, `enhancement`, `bug fix`, `known issue`, `workaround`

### Low
- ドキュメント更新
- お知らせ
- プレビュー/ベータ版

**キーワード例**: `documentation`, `informational`, `announce`, `preview`, `beta`

## Slack通知フォーマット

```
[Release Monitor] 今週の更新: N件

重要度別サマリ
🔴 Critical: X件
🔶 High: X件
🔷 Medium: X件
⚪ Low: X件

重要な更新 (Critical/High)
🔴 [CRITICAL] Firebase iOS
  Title: Security update v10.x.x
  判定理由: security, vulnerability
  <URL|詳細を見る>

...

推奨アクション
• Critical項目を優先的に確認し、即座に対応を検討してください
• High項目について、影響範囲と対応期限を調査してください
• インフラ関連: サーバー環境への影響を確認
```

## キャッシュと差分検知

- `cache/state.json` に前回実行時の状態を保存
- 次回実行時に新規項目のみを検出して通知
- 初回実行時は通知せずキャッシュを初期化（大量通知を防ぐ）

### キャッシュリセット

キャッシュをリセットして再初期化する場合：

```bash
rm monitor/cache/state.json
node run.js  # 初回実行（通知なし）
```

または GitHub Actions の cache を削除：
- Actions > Caches > `release-monitor-cache-*` を削除

## トラブルシューティング

### GitHub API Rate Limit

**症状**: `GitHub fetch failed: HTTP 403`

**対処**:
- トークン不要で実行していますが、レート制限に達する場合があります
- 監視対象のGitHubリポジトリ数を減らす
- または GitHub Personal Access Token を環境変数に追加（将来の拡張）

### RSS取得失敗

**症状**: `RSS fetch failed: HTTP 404/500`

**対処**:
- URLが変更されていないか確認
- `sources.json` で該当ソースを `"enabled": false` に設定して一時的に無効化

### HTML解析が不安定

**症状**: 取得できたりできなかったり

**対処**:
- HTMLスクレイピングは構造変更に弱いため、可能であればRSSやAPIに切り替え
- `sources.json` で `"type": "reference"` に変更し、手動確認に切り替え

### Slack通知が届かない

**症状**: ワークフローは成功するが通知が来ない

**チェック項目**:
1. `SLACK_WEBHOOK_URL` が正しく設定されているか確認
2. ログで `No new items to report` となっていないか確認（差分なしの場合は通知しない）
3. 初回実行の場合は通知されない（`FIRST RUN: Initializing cache` がログに出る）

### 失敗時の通知

ワークフロー自体が失敗した場合、エラー通知がSlackに送信されます（webhookが設定されている場合）。
GitHub Actionsのログで詳細を確認してください。

## TODO / 今後の拡張

以下は現在未実装のため、手動確認または今後の実装が必要です：

### 高優先度
- [ ] 東証API: PDFメール添付の監視（現在はWebページのみ）
- [ ] EDINET API: メール通知の監視（現在は無効化）
- [ ] SuperChart: プライベートリポジトリへのアクセス（トークン必要）

### 中優先度
- [ ] WWDC情報: Zenn/Qiita検索結果の自動監視（現在は参照リンクのみ）
- [ ] カブコムAPI: 詳細な変更内容の自動抽出（現在は基本的な検知のみ）
- [ ] Firebase/OpenAI: より詳細なHTMLパーサー（現在は簡易実装）

### 低優先度
- [ ] GitHub Personal Access Token対応（レート制限対策）
- [ ] Slackへのインタラクティブボタン追加（「確認済み」マーク等）
- [ ] 過去の通知履歴をGitHub Issuesに自動記録
- [ ] 独自の監視スクリプト追加（プラグイン機構）

## ファイル構成

```
monitor/
├── README.md              このファイル
├── run.js                 メインエントリーポイント
├── slack.js               Slack通知ロジック
├── config/
│   └── sources.json       監視対象設定
├── lib/
│   ├── fetchers.js        データ取得（RSS/GitHub/HTML）
│   ├── scorer.js          重要度判定ロジック
│   └── cache.js           キャッシュ管理
└── cache/
    └── state.json         実行状態キャッシュ（自動生成）
```

## 運用上の注意

### 更新頻度

- 週次実行（月曜 10:00 JST）を推奨
- iOS/Androidリリース直後は手動実行も検討
- WWDC/Google I/O期間中は頻度を上げても良い

### 通知の扱い

- Critical/High は即座に確認
- Medium は週次ミーティングで議題に
- Low は必要に応じて確認

### 監視対象の見直し

- 四半期に1回程度、`sources.json` を見直し
- 使われなくなったサービスは `enabled: false` に
- 新規サービス導入時は監視対象に追加

## ライセンス

このプロジェクト専用のモニタリングツールです。
