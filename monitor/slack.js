const https = require('https');
const { URL } = require('url');

/**
 * Post message to Slack webhook
 */
async function postToSlack(webhookUrl, message) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const payload = JSON.stringify(message);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, response: data });
        } else {
          reject(new Error(`Slack webhook failed: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Format items for Slack message
 */
function formatMessage(newItems, stats) {
  const severityEmoji = {
    critical: ':red_circle:',
    high: ':large_orange_diamond:',
    medium: ':large_blue_diamond:',
    low: ':white_circle:'
  };

  // Build header
  let text = `*[Release Monitor] 今週の更新: ${stats.total}件*\n\n`;

  // Summary stats
  text += '*重要度別サマリ*\n';
  text += `${severityEmoji.critical} Critical: ${stats.critical}件\n`;
  text += `${severityEmoji.high} High: ${stats.high}件\n`;
  text += `${severityEmoji.medium} Medium: ${stats.medium}件\n`;
  text += `${severityEmoji.low} Low: ${stats.low}件\n`;
  text += '\n';

  // High and Critical items - show details
  const criticalAndHigh = newItems.filter(
    item => item.severity === 'critical' || item.severity === 'high'
  );

  if (criticalAndHigh.length > 0) {
    text += `*重要な更新 (Critical/High)*\n`;

    criticalAndHigh.forEach(item => {
      const emoji = severityEmoji[item.severity];
      const reasons = item.severityReasons.length > 0
        ? ` (${item.severityReasons.join(', ')})`
        : '';

      text += `${emoji} *[${item.severity.toUpperCase()}] ${item.sourceName}*\n`;
      text += `  ${item.title}\n`;

      if (reasons) {
        text += `  _判定理由: ${reasons}_\n`;
      }

      text += `  <${item.url}|詳細を見る>\n`;
      text += '\n';
    });
  }

  // Medium items - compact view
  const mediumItems = newItems.filter(item => item.severity === 'medium');

  if (mediumItems.length > 0) {
    text += `*Medium優先度の更新 (${mediumItems.length}件)*\n`;

    mediumItems.slice(0, 5).forEach(item => {
      text += `• ${item.sourceName}: ${item.title} <${item.url}|→>\n`;
    });

    if (mediumItems.length > 5) {
      text += `_...他${mediumItems.length - 5}件_\n`;
    }
    text += '\n';
  }

  // Low items - summary only
  const lowItems = newItems.filter(item => item.severity === 'low');

  if (lowItems.length > 0) {
    text += `*その他の更新 (Low: ${lowItems.length}件)*\n`;
    text += '_詳細は監視ログを確認してください_\n';
    text += '\n';
  }

  // Next actions
  text += '*推奨アクション*\n';

  if (stats.critical > 0) {
    text += '• Critical項目を優先的に確認し、即座に対応を検討してください\n';
  }

  if (stats.high > 0) {
    text += '• High項目について、影響範囲と対応期限を調査してください\n';
  }

  if (criticalAndHigh.length > 0) {
    // Suggest specific actions based on categories
    const categories = [...new Set(criticalAndHigh.map(i => i.category))];

    if (categories.includes('infrastructure')) {
      text += '• インフラ関連: サーバー環境への影響を確認\n';
    }
    if (categories.includes('server')) {
      text += '• サーバー関連: API/SDK依存関係を確認し、必要に応じてアップデート\n';
    }
    if (categories.includes('app')) {
      text += '• アプリ関連: iOS/Androidアプリへの影響を調査し、ビルド検証を実施\n';
    }
  }

  if (stats.total === 0) {
    text = '*[Release Monitor] 今週の更新: なし*\n\n';
    text += '新しい重要な更新は検出されませんでした。';
  }

  return text;
}

/**
 * Build and send Slack notification
 */
async function sendNotification(webhookUrl, newItems, stats) {
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL is not configured');
  }

  console.log(`Preparing Slack notification for ${stats.total} items...`);

  const text = formatMessage(newItems, stats);

  const message = {
    text,
    mrkdwn: true
  };

  try {
    await postToSlack(webhookUrl, message);
    console.log('Slack notification sent successfully');
    return { success: true };
  } catch (error) {
    console.error('Failed to send Slack notification:', error.message);
    throw error;
  }
}

/**
 * Send error notification to Slack
 */
async function sendErrorNotification(webhookUrl, error, context = '') {
  if (!webhookUrl) {
    console.error('Cannot send error notification - webhook URL not configured');
    return;
  }

  const text = `*[Release Monitor] エラー発生*\n\n` +
    `監視処理中にエラーが発生しました。\n\n` +
    `*エラー内容:*\n\`\`\`${error.message}\`\`\`\n\n` +
    `*コンテキスト:* ${context}\n\n` +
    `詳細はGitHub Actionsのログを確認してください。`;

  const message = {
    text,
    mrkdwn: true
  };

  try {
    await postToSlack(webhookUrl, message);
    console.log('Error notification sent to Slack');
  } catch (err) {
    console.error('Failed to send error notification:', err.message);
  }
}

module.exports = {
  sendNotification,
  sendErrorNotification,
  formatMessage
};
