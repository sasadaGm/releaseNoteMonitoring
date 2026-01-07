#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { fetchAllSources } = require('./lib/fetchers');
const { scoreAllItems, getSummaryStats } = require('./lib/scorer');
const { loadState, saveState, getNewItems, updateState, getCacheStats } = require('./lib/cache');
const { sendNotification, sendErrorNotification } = require('./slack');

/**
 * Load sources configuration
 */
function loadSources() {
  const configPath = path.join(__dirname, 'config', 'sources.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  try {
    const data = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(data);
    return config.sources || [];
  } catch (error) {
    throw new Error(`Failed to load sources config: ${error.message}`);
  }
}

/**
 * Main monitoring process
 */
async function main() {
  console.log('='.repeat(60));
  console.log('SDK/Release Monitor - Starting');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const dryRun = process.env.DRY_RUN === 'true';
  const forceNotify = process.env.FORCE_NOTIFY === 'true';

  if (!webhookUrl && !dryRun) {
    console.warn('WARNING: SLACK_WEBHOOK_URL not set. Running in dry-run mode.');
  }

  if (forceNotify) {
    console.warn('⚠️  FORCE_NOTIFY mode enabled - all items will be treated as new\n');
  }

  try {
    // Step 1: Load configuration
    console.log('[1/6] Loading configuration...');
    const sources = loadSources();
    const enabledSources = sources.filter(s => s.enabled);
    console.log(`Loaded ${enabledSources.length} enabled sources (${sources.length} total)\n`);

    // Step 2: Fetch from all sources
    console.log('[2/6] Fetching from sources...');
    const sourceResults = await fetchAllSources(enabledSources, 2);

    const totalFetched = Object.values(sourceResults).reduce(
      (sum, items) => sum + items.length,
      0
    );
    console.log(`Fetched ${totalFetched} items from ${Object.keys(sourceResults).length} sources\n`);

    // Step 3: Score items
    console.log('[3/6] Scoring items...');
    const scoredItems = scoreAllItems(sourceResults, sources);
    console.log(`Scored ${scoredItems.length} items\n`);

    // Step 4: Check cache and get diff
    console.log('[4/6] Checking cache for new items...');
    const previousState = loadState();

    let newItems, isFirstRun;

    if (forceNotify) {
      // Force mode: treat all items as new
      newItems = scoredItems;
      isFirstRun = false;
      console.log('FORCE_NOTIFY: Treating all items as new');
    } else {
      const result = getNewItems(scoredItems, previousState);
      newItems = result.newItems;
      isFirstRun = result.isFirstRun;
    }

    console.log(`Previous state: ${previousState.initialized ? 'initialized' : 'not initialized'}`);
    console.log(`First run: ${isFirstRun}`);
    console.log(`New items: ${newItems.length}\n`);

    if (isFirstRun) {
      console.log('FIRST RUN: Initializing cache without sending notifications');
    }

    // Step 5: Update cache
    console.log('[5/6] Updating cache...');
    const newState = updateState(scoredItems);
    saveState(newState);
    console.log('Cache updated successfully\n');

    // Step 6: Send notification (if not first run and there are new items)
    console.log('[6/6] Preparing notification...');

    if (isFirstRun) {
      console.log('Skipping notification (first run)');
      console.log('\n' + '='.repeat(60));
      console.log('Initialization complete - cache is ready');
      console.log('Next run will detect and report new items');
      console.log('='.repeat(60));
      return;
    }

    // Generate stats for new items (even if 0)
    const stats = getSummaryStats(newItems);

    if (newItems.length === 0) {
      console.log('No new items to report - but will send notification');
    }

    console.log('\nNew items summary:');
    console.log(`  Total: ${stats.total}`);
    console.log(`  Critical: ${stats.critical}`);
    console.log(`  High: ${stats.high}`);
    console.log(`  Medium: ${stats.medium}`);
    console.log(`  Low: ${stats.low}`);

    // Send to Slack
    const monitoringPeriod = {
      isFirstRun: false, // Always false here since first run exits early
      lastRun: previousState.lastRun,
      currentRun: newState.lastRun
    };

    if (dryRun) {
      console.log('\nDRY RUN: Would send notification with:');
      console.log(JSON.stringify(stats, null, 2));
    } else if (webhookUrl) {
      await sendNotification(webhookUrl, newItems, stats, monitoringPeriod);
      console.log('\n✓ Notification sent to Slack');
    }

    console.log('\n' + '='.repeat(60));
    console.log('Monitor complete');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('ERROR:', error.message);
    console.error('='.repeat(60));
    console.error(error.stack);

    // Try to send error notification
    if (webhookUrl && !dryRun) {
      try {
        await sendErrorNotification(webhookUrl, error, 'Main monitoring process');
      } catch (notifyError) {
        console.error('Failed to send error notification:', notifyError.message);
      }
    }

    process.exit(1);
  }
}

/**
 * Show cache statistics
 */
function showStats() {
  console.log('='.repeat(60));
  console.log('Cache Statistics');
  console.log('='.repeat(60));

  const stats = getCacheStats();

  if (!stats.initialized) {
    console.log('Cache not initialized yet');
    return;
  }

  console.log(`Last run: ${stats.lastRun}`);
  console.log(`Sources tracked: ${stats.sourceCount}`);
  console.log(`Total items cached: ${stats.totalItems}\n`);

  console.log('Sources:');
  stats.sources.forEach(source => {
    console.log(`  ${source.id}:`);
    console.log(`    Items: ${source.itemCount}`);
    console.log(`    Last updated: ${source.lastUpdated}`);
    if (source.latestTitle) {
      console.log(`    Latest: ${source.latestTitle.substring(0, 60)}...`);
    }
  });

  console.log('='.repeat(60));
}

// CLI handling
const command = process.argv[2];

if (command === 'stats') {
  showStats();
} else if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`
SDK/Release Monitor

Usage:
  node run.js           Run the monitoring process
  node run.js stats     Show cache statistics
  node run.js help      Show this help message

Environment Variables:
  SLACK_WEBHOOK_URL     Slack incoming webhook URL (required for notifications)
  DRY_RUN=true          Run without sending Slack notifications
  `);
} else {
  // Default: run monitor
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
