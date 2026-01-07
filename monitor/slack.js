const https = require('https');
const { URL } = require('url');

/**
 * Format date in Japanese style
 * @param {Date} date - Date object
 * @returns {string} - Formatted date like "2026年1月9日 10:00"
 */
function formatJapaneseDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 0-indexed
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}年${month}月${day}日 ${hours}:${minutes}`;
}

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
function formatMessage(newItems, stats, monitoringPeriod = {}) {
  const severityEmoji = {
    critical: ':red_circle:',
    high: ':large_orange_diamond:',
    medium: ':large_blue_diamond:',
    low: ':white_circle:'
  };

  const categoryEmoji = {
    infrastructure: ':gear:',
    server: ':desktop_computer:',
    app: ':iphone:'
  };

  const categoryNames = {
    infrastructure: 'インフラ系',
    server: 'サーバー系',
    app: 'アプリ系'
  };

  // Build header with monitoring period
  let text = '';

  if (monitoringPeriod.isFirstRun) {
    // First run
    const currentDate = new Date(monitoringPeriod.currentRun);
    const formattedDate = formatJapaneseDate(currentDate);
    text += `*[Release Monitor] 初回実行*\n`;
    text += `📅 実行日時: ${formattedDate}\n`;
    text += `※過去データがないため、現時点の情報のみを表示しています\n\n`;
  } else if (monitoringPeriod.lastRun && monitoringPeriod.currentRun) {
    // Normal run with period
    const lastDate = new Date(monitoringPeriod.lastRun);
    const currentDate = new Date(monitoringPeriod.currentRun);
    const formattedLast = formatJapaneseDate(lastDate);
    const formattedCurrent = formatJapaneseDate(currentDate);
    text += `*[Release Monitor] 今週の更新: ${stats.total}件*\n`;
    text += `📅 監視期間: ${formattedLast} 〜 ${formattedCurrent}\n\n`;
  } else {
    // Fallback (no period info)
    text += `*[Release Monitor] 今週の更新: ${stats.total}件*\n\n`;
  }

  // Summary stats by category
  text += '*カテゴリー別サマリ*\n';
  Object.entries(stats.byCategory).forEach(([category, catStats]) => {
    const emoji = categoryEmoji[category] || ':question:';
    const name = categoryNames[category] || category;
    text += `${emoji} ${name}: ${catStats.total}件 `;
    text += `(Critical:${catStats.critical} High:${catStats.high} Medium:${catStats.medium} Low:${catStats.low})\n`;
  });
  text += '\n';

  // Overall severity summary
  text += '*重要度別サマリ*\n';
  text += `${severityEmoji.critical} Critical: ${stats.critical}件 `;
  text += `${severityEmoji.high} High: ${stats.high}件 `;
  text += `${severityEmoji.medium} Medium: ${stats.medium}件 `;
  text += `${severityEmoji.low} Low: ${stats.low}件\n`;
  text += '\n';

  // High and Critical items - show details by category
  const criticalAndHigh = newItems.filter(
    item => item.severity === 'critical' || item.severity === 'high'
  );

  if (criticalAndHigh.length > 0) {
    text += `*重要な更新 (Critical/High): ${criticalAndHigh.length}件*\n\n`;

    // Group by category
    const categories = ['infrastructure', 'server', 'app'];

    categories.forEach(category => {
      const categoryItems = criticalAndHigh.filter(item => item.category === category);

      if (categoryItems.length > 0) {
        const emoji = categoryEmoji[category] || ':question:';
        const name = categoryNames[category] || category;
        text += `${emoji} *${name}* (${categoryItems.length}件)\n`;

        categoryItems.forEach(item => {
          const severityIcon = severityEmoji[item.severity];
          const reasons = item.severityReasons.length > 0
            ? ` _[${item.severityReasons.join(', ')}]_`
            : '';

          text += `  ${severityIcon} ${item.sourceName}: ${item.title}${reasons}\n`;
          text += `     <${item.url}|詳細を見る>\n`;
        });

        text += '\n';
      }
    });
  }

  // Medium items - compact view by category
  const mediumItems = newItems.filter(item => item.severity === 'medium');

  if (mediumItems.length > 0) {
    text += `*Medium優先度の更新: ${mediumItems.length}件*\n\n`;

    const categories = ['infrastructure', 'server', 'app'];

    categories.forEach(category => {
      const categoryItems = mediumItems.filter(item => item.category === category);

      if (categoryItems.length > 0) {
        const emoji = categoryEmoji[category] || ':question:';
        const name = categoryNames[category] || category;
        text += `${emoji} *${name}* (${categoryItems.length}件)\n`;

        categoryItems.slice(0, 3).forEach(item => {
          text += `  • ${item.sourceName}: ${item.title.substring(0, 50)}... <${item.url}|詳細>\n`;
        });

        if (categoryItems.length > 3) {
          text += `  _...他${categoryItems.length - 3}件_\n`;
        }
        text += '\n';
      }
    });
  }

  // Low items - summary only by category
  const lowItems = newItems.filter(item => item.severity === 'low');

  if (lowItems.length > 0) {
    text += `*その他の更新 (Low): ${lowItems.length}件*\n`;

    const categories = ['infrastructure', 'server', 'app'];
    const categoryCounts = {};

    categories.forEach(category => {
      const count = lowItems.filter(item => item.category === category).length;
      if (count > 0) {
        const emoji = categoryEmoji[category] || ':question:';
        const name = categoryNames[category] || category;
        categoryCounts[category] = count;
        text += `${emoji} ${name}: ${count}件  `;
      }
    });

    text += '\n_詳細は監視ログを確認してください_\n';
    text += '\n';
  }

  // Next actions - category-specific
  text += '*推奨アクション*\n';

  if (stats.critical > 0) {
    text += '• :rotating_light: *Critical項目*: 即座に確認し対応を開始してください\n';
  }

  if (stats.high > 0) {
    text += '• :warning: *High項目*: 影響範囲と対応期限を調査してください\n';
  }

  // Category-specific actions
  const actionsByCategory = {
    infrastructure: [],
    server: [],
    app: []
  };

  if (criticalAndHigh.length > 0) {
    const categories = [...new Set(criticalAndHigh.map(i => i.category))];

    if (categories.includes('infrastructure')) {
      actionsByCategory.infrastructure.push('サーバー環境・ミドルウェアへの影響確認');
      actionsByCategory.infrastructure.push('セキュリティパッチの適用検討');
    }
    if (categories.includes('server')) {
      actionsByCategory.server.push('API/SDK依存関係の確認');
      actionsByCategory.server.push('互換性テストの実施');
      actionsByCategory.server.push('必要に応じてライブラリのアップデート');
    }
    if (categories.includes('app')) {
      actionsByCategory.app.push('iOS/Androidアプリへの影響調査');
      actionsByCategory.app.push('ビルド検証・テスト実施');
      actionsByCategory.app.push('ストア申請要件の確認');
    }
  }

  // Output category-specific actions
  Object.entries(actionsByCategory).forEach(([category, actions]) => {
    if (actions.length > 0) {
      const emoji = categoryEmoji[category] || ':question:';
      const name = categoryNames[category] || category;
      text += `• ${emoji} *${name}*: ${actions.join('、')}\n`;
    }
  });

  if (stats.total === 0) {
    text = '*[Release Monitor] 今週の更新: なし*\n\n';
    text += '新しい重要な更新は検出されませんでした。';
  }

  return text;
}

/**
 * Build and send Slack notification
 */
async function sendNotification(webhookUrl, newItems, stats, monitoringPeriod = {}) {
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL is not configured');
  }

  console.log(`Preparing Slack notification for ${stats.total} items...`);

  const text = formatMessage(newItems, stats, monitoringPeriod);

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
