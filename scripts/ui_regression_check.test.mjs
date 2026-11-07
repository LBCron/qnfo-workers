#!/usr/bin/env node
// Test suite for UI regression checker
import { extractUIStructure } from './ui_regression_check.mjs';
import assert from 'node:assert';

// Test: Detects tab navigation
const withTabs = '<nav class="tabs"><button>Tab 1</button></nav>';
const withoutTabs = '<div class="simple"><button>Action</button></div>';

const tabsResult = extractUIStructure(withTabs);
const noTabsResult = extractUIStructure(withoutTabs);

assert.strictEqual(tabsResult.patterns.hasTabNav, true, 'Should detect tab navigation');
assert.strictEqual(noTabsResult.patterns.hasTabNav, false, 'Should not detect tabs in simple div');

// Test: Counts sections
const manySection = '<section>1</section><section>2</section><section>3</section><section>4</section><section>5</section>';
const fewSections = '<section>1</section><section>2</section>';

const manyResult = extractUIStructure(manySection);
const fewResult = extractUIStructure(fewSections);

assert.strictEqual(manyResult.structure.sections, 5, 'Should count 5 sections');
assert.strictEqual(fewResult.structure.sections, 2, 'Should count 2 sections');
assert.strictEqual(manyResult.patterns.hasMultipleSections, true, 'Should detect multiple sections');
assert.strictEqual(fewResult.patterns.hasMultipleSections, false, 'Should not flag 2 sections as multiple');

// Test: Detects stacked sections with data-view
const stackedSections = '<section data-view="one">A</section><section data-view="two">B</section>';
const singleSection = '<section data-view="main">Content</section>';

const stackedResult = extractUIStructure(stackedSections);
const singleResult = extractUIStructure(singleSection);

assert.strictEqual(stackedResult.patterns.stackedSections, true, 'Should detect stacked sections');
assert.strictEqual(singleResult.patterns.stackedSections, false, 'Should not flag single section');

console.log('✓ All UI regression check tests passed');
