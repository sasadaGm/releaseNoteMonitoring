const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const STATE_FILE = path.join(CACHE_DIR, 'state.json');

/**
 * Ensure cache directory exists
 */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Load previous state from cache
 */
function loadState() {
  ensureCacheDir();

  if (!fs.existsSync(STATE_FILE)) {
    return {
      lastRun: null,
      initialized: false,
      sources: {}
    };
  }

  try {
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load cache state:', error.message);
    return {
      lastRun: null,
      initialized: false,
      sources: {}
    };
  }
}

/**
 * Save current state to cache
 */
function saveState(state) {
  ensureCacheDir();

  try {
    const data = JSON.stringify(state, null, 2);
    fs.writeFileSync(STATE_FILE, data, 'utf8');
    console.log('Cache state saved successfully');
  } catch (error) {
    console.error('Failed to save cache state:', error.message);
    throw error;
  }
}

/**
 * Get new items by comparing with cached state
 */
function getNewItems(scoredItems, previousState) {
  if (!previousState.initialized) {
    console.log('First run detected - initializing cache only');
    return {
      newItems: [],
      isFirstRun: true
    };
  }

  const newItems = [];
  const seenIds = new Set();

  // Build set of previously seen item IDs
  Object.values(previousState.sources).forEach(sourceState => {
    if (sourceState.seenIds) {
      sourceState.seenIds.forEach(id => seenIds.add(id));
    }
  });

  // Find items not in previous state
  scoredItems.forEach(item => {
    if (!seenIds.has(item.id)) {
      newItems.push(item);
    }
  });

  return {
    newItems,
    isFirstRun: false
  };
}

/**
 * Update state with current items
 */
function updateState(scoredItems) {
  const state = {
    lastRun: new Date().toISOString(),
    initialized: true,
    sources: {}
  };

  // Group items by source
  const itemsBySource = {};
  scoredItems.forEach(item => {
    if (!itemsBySource[item.source]) {
      itemsBySource[item.source] = [];
    }
    itemsBySource[item.source].push(item);
  });

  // Build state for each source
  Object.entries(itemsBySource).forEach(([sourceId, items]) => {
    state.sources[sourceId] = {
      lastUpdated: new Date().toISOString(),
      itemCount: items.length,
      seenIds: items.map(item => item.id),
      latestItem: items.length > 0 ? {
        id: items[0].id,
        title: items[0].title,
        publishedAt: items[0].publishedAt
      } : null
    };
  });

  return state;
}

/**
 * Get cache statistics for reporting
 */
function getCacheStats() {
  const state = loadState();

  if (!state.initialized) {
    return {
      initialized: false,
      message: 'Cache not initialized'
    };
  }

  const sourceCount = Object.keys(state.sources).length;
  const totalItems = Object.values(state.sources).reduce(
    (sum, src) => sum + (src.itemCount || 0),
    0
  );

  return {
    initialized: true,
    lastRun: state.lastRun,
    sourceCount,
    totalItems,
    sources: Object.entries(state.sources).map(([id, data]) => ({
      id,
      lastUpdated: data.lastUpdated,
      itemCount: data.itemCount,
      latestTitle: data.latestItem?.title
    }))
  };
}

/**
 * Reset cache (for testing or manual reset)
 */
function resetCache() {
  ensureCacheDir();

  const backupFile = path.join(
    CACHE_DIR,
    `state_backup_${Date.now()}.json`
  );

  if (fs.existsSync(STATE_FILE)) {
    fs.copyFileSync(STATE_FILE, backupFile);
    console.log(`Cache backed up to: ${backupFile}`);
    fs.unlinkSync(STATE_FILE);
  }

  console.log('Cache reset complete');
}

module.exports = {
  loadState,
  saveState,
  getNewItems,
  updateState,
  getCacheStats,
  resetCache
};
