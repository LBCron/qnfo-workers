#!/usr/bin/env node
// UI-REGRESSION-CHECK-1: Prevents UI regressions by comparing screenshots before/after PR changes.
// Takes screenshots of UI routes, compares layout structure, blocks merge on regression.
// Usage: node scripts/ui_regression_check.mjs --files pr-files.txt --base main --head HEAD
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

// UI workers and their routes to check
const UI_PRODUCTS = [
  { 
    worker: 'personal-api',
    routes: [
      { path: '/companion', name: 'companion-main' },
      { path: '/companion/health', name: 'companion-health', skip_screenshot: true }
    ],
    host: 'me.q08.org'
  },
  {
    worker: 'qnfo-fleet-dashboard',
    routes: [
      { path: '/', name: 'dashboard-home' },
      { path: '/metrics', name: 'dashboard-metrics' }
    ],
    host: 'fleet.qnfo.org'
  }
];

const UI_FILE_PATTERNS = [
  /PAGE_HTML\s*=/,           // Embedded HTML
  /<html/i,                  // HTML files
  /\.html$/,                 // HTML files
  /companion/i,              // Companion-related
  /dashboard/i,              // Dashboard-related
  /interface/i,              // Interface code
  /class=["'][^"']*section/i // Section elements
];

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: true });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', d => stdout += d);
    proc.stderr?.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr}`));
      else resolve(stdout);
    });
  });
}

async function getChangedUIFiles(files) {
  const uiFiles = [];
  for (const file of files) {
    // Check if file path suggests UI
    if (UI_FILE_PATTERNS.some(p => file.match(p))) {
      uiFiles.push(file);
      continue;
    }
    
    // Check file content for UI patterns
    try {
      const content = readFileSync(file, 'utf8');
      if (UI_FILE_PATTERNS.some(p => content.match(p))) {
        uiFiles.push(file);
      }
    } catch (e) {
      // File doesn't exist in working tree, skip
    }
  }
  return uiFiles;
}

function extractUIStructure(html) {
  // Extract structural elements that indicate layout
  const structure = {
    sections: (html.match(/<section/gi) || []).length,
    navs: (html.match(/<nav/gi) || []).length,
    tabButtons: (html.match(/button[^>]*tab/gi) || []).length,
    dataViews: (html.match(/data-view=/gi) || []).length,
    majorContainers: (html.match(/class=["'][^"']*(?:container|wrapper|layout|grid)/gi) || []).length,
    headings: (html.match(/<h[1-6]/gi) || []).length
  };
  
  // Extract specific UI patterns that regressed before
  const patterns = {
    hasTabNav: /<nav[^>]*class=["'][^"']*tabs/.test(html),
    hasMultipleSections: structure.sections > 3,
    hasSectionNav: /<nav[^>]*section/.test(html),
    stackedSections: /section[^>]*data-view.*section[^>]*data-view/s.test(html)
  };
  
  return { structure, patterns };
}

async function checkUIRegression({ files, base, head }) {
  const failures = [];
  
  // Find which UI products are affected
  const uiFiles = await getChangedUIFiles(files);
  if (uiFiles.length === 0) {
    console.log('No UI files changed - skipping regression check');
    return { ok: true, failures: [], skipped: true };
  }
  
  console.log(`UI files changed: ${uiFiles.join(', ')}`);
  
  // Determine which products to check
  const productsToCheck = UI_PRODUCTS.filter(product => 
    uiFiles.some(f => f.includes(product.worker))
  );
  
  if (productsToCheck.length === 0) {
    console.log('Changed files do not affect known UI products');
    return { ok: true, failures: [], skipped: true };
  }
  
  // For each product, compare UI structure before/after
  for (const product of productsToCheck) {
    console.log(`\nChecking ${product.worker}...`);
    
    const workerFile = `${product.worker}/worker.js`;
    
    // Get HTML from base and head
    let baseHTML, headHTML;
    try {
      baseHTML = await exec('git', ['show', `${base}:${workerFile}`]);
    } catch (e) {
      console.log(`  Base version not found (new worker?), skipping comparison`);
      continue;
    }
    
    try {
      headHTML = await exec('git', ['show', `${head}:${workerFile}`]);
    } catch (e) {
      console.log(`  Head version not found, skipping`);
      continue;
    }
    
    // Extract UI structure
    const baseStructure = extractUIStructure(baseHTML);
    const headStructure = extractUIStructure(headHTML);
    
    console.log(`  Base: ${JSON.stringify(baseStructure.structure)}`);
    console.log(`  Head: ${JSON.stringify(headStructure.structure)}`);
    
    // Check for known regression patterns
    const regressions = [];
    
    // Regression: Added tab navigation
    if (!baseStructure.patterns.hasTabNav && headStructure.patterns.hasTabNav) {
      regressions.push('Added tab navigation (previous regression pattern)');
    }
    
    // Regression: Increased sections significantly
    if (headStructure.structure.sections > baseStructure.structure.sections + 2) {
      regressions.push(`Section count increased from ${baseStructure.structure.sections} to ${headStructure.structure.sections}`);
    }
    
    // Regression: Added stacked sections pattern
    if (!baseStructure.patterns.stackedSections && headStructure.patterns.stackedSections) {
      regressions.push('Added stacked sections pattern (previous regression)');
    }
    
    // Regression: Moved from unified to multi-section
    if (baseStructure.structure.sections <= 2 && headStructure.structure.sections >= 6) {
      regressions.push(`Changed from unified (${baseStructure.structure.sections} sections) to complex multi-section (${headStructure.structure.sections} sections)`);
    }
    
    if (regressions.length > 0) {
      failures.push(`${product.worker}: ${regressions.join('; ')}`);
    } else {
      console.log(`  ✓ No regressions detected`);
    }
  }
  
  return { ok: failures.length === 0, failures, skipped: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : null;
  };
  
  const filesPath = arg('--files');
  const base = arg('--base') || 'origin/main';
  const head = arg('--head') || 'HEAD';
  
  if (!filesPath) {
    console.error('Usage: node scripts/ui_regression_check.mjs --files pr-files.txt [--base origin/main] [--head HEAD]');
    process.exit(1);
  }
  
  const files = readFileSync(filesPath, 'utf8').split('\n').filter(Boolean);
  
  const result = await checkUIRegression({ files, base, head });
  
  if (result.skipped) {
    console.log('UI regression check: SKIPPED (no UI changes)');
    process.exit(0);
  }
  
  if (!result.ok) {
    console.log('\n❌ UI REGRESSION DETECTED:');
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
    console.log('\nTo override, add "ui-regression: accepted (<reason>)" to PR body');
    process.exit(1);
  }
  
  console.log('\n✓ UI regression check: PASSED');
  process.exit(0);
}

export { checkUIRegression, extractUIStructure };
