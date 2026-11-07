#!/usr/bin/env node
/**
 * Tests for deploy-gate-domain-separation.py
 * Verifies DOMAIN-PLANE-1 enforcement: personal=q08.org, fleet=qnfo.org
 */
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const GUARD = 'python3 scripts/deploy-gate-domain-separation.py';
let fails = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}`);
    console.error(e.message);
    fails++;
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertIncludes(text, substring, msg) {
  if (!text.includes(substring)) {
    throw new Error(`${msg}: expected to include "${substring}"`);
  }
}

// Test 1: Personal worker with fleet code should fail
test('personal worker with fleet reference fails', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'domain-sep-'));
  const testFile = join(tmpDir, 'personal-api-worker.js');
  
  writeFileSync(testFile, `
    async function handleRequest(req) {
      const fleetAsks = await getFleetAsks();
      return new Response('OK');
    }
  `);
  
  const fileList = join(tmpDir, 'files.txt');
  writeFileSync(fileList, 'personal-api/worker.js');
  
  try {
    execSync(`${GUARD} --files ${fileList}`, { 
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    throw new Error('Should have failed');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    assertIncludes(stderr, 'fleetAsks', 'error should mention fleet reference');
    assertIncludes(stderr, 'Personal worker contains fleet reference', 'error should explain violation');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

// Test 2: Personal worker with fleet.qnfo.org URL should fail
test('personal worker with fleet URL fails', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'domain-sep-'));
  const testFile = join(tmpDir, 'personal-companion-worker.js');
  
  writeFileSync(testFile, `
    const FLEET_URL = 'https://fleet.qnfo.org/api/status';
  `);
  
  const fileList = join(tmpDir, 'files.txt');
  writeFileSync(fileList, 'personal-companion/worker.js');
  
  try {
    execSync(`${GUARD} --files ${fileList}`, { 
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    throw new Error('Should have failed');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    assertIncludes(stderr, 'fleet.qnfo.org', 'error should mention fleet URL');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

// Test 3: Fleet worker with personal code should fail
test('fleet worker with personal reference fails', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'domain-sep-'));
  const testFile = join(tmpDir, 'qnfo-ai-worker.js');
  
  writeFileSync(testFile, `
    const PERSONAL_API = 'https://me.q08.org/api/companion';
  `);
  
  const fileList = join(tmpDir, 'files.txt');
  writeFileSync(fileList, 'qnfo-ai/worker.js');
  
  try {
    execSync(`${GUARD} --files ${fileList}`, { 
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    throw new Error('Should have failed');
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    assertIncludes(stderr, 'me.q08.org', 'error should mention personal URL');
    assertIncludes(stderr, 'Fleet worker contains personal reference', 'error should explain violation');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

// Test 4: Non-domain worker should pass (not checked)
test('non-domain worker passes', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'domain-sep-'));
  const testFile = join(tmpDir, 'some-other-worker.js');
  
  writeFileSync(testFile, `
    const fleetAsks = 'this is allowed in other workers';
  `);
  
  const fileList = join(tmpDir, 'files.txt');
  writeFileSync(fileList, 'some-other/worker.js');
  
  try {
    const output = execSync(`${GUARD} --files ${fileList}`, { 
      cwd: process.cwd(),
      encoding: 'utf-8'
    });
    assertIncludes(output, '0 violations', 'should pass with 0 violations');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

// Test 5: Clean personal worker should pass
test('clean personal worker passes', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'domain-sep-'));
  const testFile = join(tmpDir, 'personal-api-worker.js');
  
  writeFileSync(testFile, `
    async function handlePersonalRequest(req) {
      return new Response('Personal content only');
    }
  `);
  
  const fileList = join(tmpDir, 'files.txt');
  writeFileSync(fileList, 'personal-api/worker.js');
  
  try {
    const output = execSync(`${GUARD} --files ${fileList}`, { 
      cwd: process.cwd(),
      encoding: 'utf-8'
    });
    assertIncludes(output, '0 violations', 'should pass with 0 violations');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

// Test 6: Clean fleet worker should pass
test('clean fleet worker passes', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'domain-sep-'));
  const testFile = join(tmpDir, 'qnfo-fleet-control-worker.js');
  
  writeFileSync(testFile, `
    async function handleFleetRequest(req) {
      return new Response('Fleet operations');
    }
  `);
  
  const fileList = join(tmpDir, 'files.txt');
  writeFileSync(fileList, 'qnfo-fleet-control/worker.js');
  
  try {
    const output = execSync(`${GUARD} --files ${fileList}`, { 
      cwd: process.cwd(),
      encoding: 'utf-8'
    });
    assertIncludes(output, '0 violations', 'should pass with 0 violations');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

console.log(`\n${fails} failed`);
process.exit(fails > 0 ? 1 : 0);
