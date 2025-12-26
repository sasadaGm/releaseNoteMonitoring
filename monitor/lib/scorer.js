/**
 * Rule-based severity scoring system
 * Analyzes title and description for keywords to determine severity level
 */

const SEVERITY_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

// Keywords and their severity weights
// Use word boundaries to avoid false positives (e.g., "rce" in "resource")
const CRITICAL_KEYWORDS = [
  'security vulnerability',
  'security issue',
  'vulnerability',
  'cve-',
  'remote code execution',
  'certificate expir',
  'service disruption',
  'outage',
  'forced upgrade',
  'end-of-life',
  'eol imminent',
  'critical security',
  'zero-day',
  'exploit',
  'malicious',
  'data breach',
  'unauthorized access'
];

const HIGH_KEYWORDS = [
  'breaking change',
  'breaking:',
  'deprecated',
  'deprecation',
  'removal',
  'removed',
  'required action',
  'action required',
  'must upgrade',
  'must update',
  'major version',
  'api removal',
  'pricing change',
  'price increase',
  'end of support',
  'migration required',
  'incompatible',
  'required update',
  'urgent'
];

const MEDIUM_KEYWORDS = [
  'minor version',
  'new feature',
  'enhancement',
  'improvement',
  'performance',
  'bug fix',
  'known issue',
  'workaround',
  'recommended update',
  'update available',
  'patch',
  'maintenance'
];

const LOW_KEYWORDS = [
  'documentation',
  'informational',
  'announce',
  'note',
  'preview',
  'beta',
  'alpha'
];

/**
 * Match keyword with word boundary awareness
 * Avoids false positives like "rce" matching "resource"
 */
function matchKeyword(text, keyword) {
  const lowerKeyword = keyword.toLowerCase();

  // Special case: keywords with hyphens or special chars (like "cve-")
  if (/[-:]/.test(lowerKeyword)) {
    return text.includes(lowerKeyword);
  }

  // Use word boundary regex to avoid partial matches
  // \b ensures we match whole words only
  const regex = new RegExp(`\\b${lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return regex.test(text);
}

/**
 * Calculate severity score for an item
 */
function scoreItem(item, source) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const matches = {
    critical: [],
    high: [],
    medium: [],
    low: []
  };

  // Check critical keywords
  CRITICAL_KEYWORDS.forEach(keyword => {
    if (matchKeyword(text, keyword)) {
      matches.critical.push(keyword);
    }
  });

  // Check high keywords
  HIGH_KEYWORDS.forEach(keyword => {
    if (matchKeyword(text, keyword)) {
      matches.high.push(keyword);
    }
  });

  // Check medium keywords
  MEDIUM_KEYWORDS.forEach(keyword => {
    if (matchKeyword(text, keyword)) {
      matches.medium.push(keyword);
    }
  });

  // Check low keywords
  LOW_KEYWORDS.forEach(keyword => {
    if (matchKeyword(text, keyword)) {
      matches.low.push(keyword);
    }
  });

  // Determine severity based on matches
  let severity = SEVERITY_LEVELS.LOW;
  let reasons = [];

  if (matches.critical.length > 0) {
    severity = SEVERITY_LEVELS.CRITICAL;
    reasons = matches.critical;
  } else if (matches.high.length > 0) {
    severity = SEVERITY_LEVELS.HIGH;
    reasons = matches.high;
  } else if (matches.medium.length > 0) {
    severity = SEVERITY_LEVELS.MEDIUM;
    reasons = matches.medium;
  } else if (matches.low.length > 0) {
    severity = SEVERITY_LEVELS.LOW;
    reasons = matches.low;
  } else {
    // No keyword match - use source hint
    severity = source.severityHint || SEVERITY_LEVELS.LOW;
    reasons = ['default from source'];
  }

  // Version-based adjustments
  if (item.version) {
    const majorVersionRegex = /^v?(\d+)\.0\.0/;
    if (majorVersionRegex.test(item.version)) {
      // Major version bump - increase severity if not already critical
      if (severity === SEVERITY_LEVELS.LOW) {
        severity = SEVERITY_LEVELS.MEDIUM;
        reasons.push('major version bump');
      } else if (severity === SEVERITY_LEVELS.MEDIUM) {
        severity = SEVERITY_LEVELS.HIGH;
        reasons.push('major version bump');
      }
    }
  }

  // Pre-release check - reduce severity
  if (item.prerelease) {
    if (severity === SEVERITY_LEVELS.HIGH) {
      severity = SEVERITY_LEVELS.MEDIUM;
      reasons.push('pre-release (reduced severity)');
    } else if (severity === SEVERITY_LEVELS.CRITICAL) {
      severity = SEVERITY_LEVELS.HIGH;
      reasons.push('pre-release (reduced severity)');
    }
  }

  return {
    severity,
    reasons: [...new Set(reasons)].slice(0, 3), // Unique, max 3 reasons
    score: getSeverityScore(severity)
  };
}

/**
 * Get numeric score for severity level
 */
function getSeverityScore(severity) {
  const scores = {
    [SEVERITY_LEVELS.CRITICAL]: 4,
    [SEVERITY_LEVELS.HIGH]: 3,
    [SEVERITY_LEVELS.MEDIUM]: 2,
    [SEVERITY_LEVELS.LOW]: 1
  };
  return scores[severity] || 1;
}

/**
 * Score all items from all sources
 */
function scoreAllItems(sourceResults, sources) {
  const scored = [];

  for (const [sourceId, items] of Object.entries(sourceResults)) {
    const source = sources.find(s => s.id === sourceId);
    if (!source) continue;

    items.forEach(item => {
      const scoringResult = scoreItem(item, source);

      scored.push({
        ...item,
        severity: scoringResult.severity,
        severityScore: scoringResult.score,
        severityReasons: scoringResult.reasons,
        category: source.category,
        sourceName: source.name
      });
    });
  }

  // Sort by severity (highest first), then by date (newest first)
  scored.sort((a, b) => {
    if (a.severityScore !== b.severityScore) {
      return b.severityScore - a.severityScore;
    }
    return b.publishedAt - a.publishedAt;
  });

  return scored;
}

/**
 * Get summary statistics
 */
function getSummaryStats(scoredItems) {
  const stats = {
    total: scoredItems.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    byCategory: {}
  };

  scoredItems.forEach(item => {
    stats[item.severity]++;

    if (!stats.byCategory[item.category]) {
      stats.byCategory[item.category] = {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      };
    }
    stats.byCategory[item.category].total++;
    stats.byCategory[item.category][item.severity]++;
  });

  return stats;
}

module.exports = {
  SEVERITY_LEVELS,
  scoreItem,
  scoreAllItems,
  getSummaryStats
};
